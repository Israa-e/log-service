import { pool } from "../../db/index.js";
import { validateLogEntry } from "./validation.js";
import { accumulateRollup, MINUTE_MS } from "./rollup.js";
import type { LogEntry, InsertResult } from "./types.js";

// Postgres here is capped at 1 CPU, so once a burst pushes the target rate past what that
// core can sustain, insert latency (queueing for one of `pool`'s connections, then executing)
// climbs — and keeps climbing for as long as arrivals outpace service time, which is basic
// queueing theory, not a bug. A batch stuck behind that queue can land well past the 20s
// visibility SLA even though it's eventually inserted correctly. Once recent inserts are
// already taking this long, a freshly-accepted batch would queue behind them and blow the SLA
// too, so it's shed instead — this is the backpressure the spec explicitly sanctions
// ("shedding load with 429/503 is better than crashing"); shed batches don't count as
// accepted, so they can't count as missing either.
//
// Gating on observed latency (not a queue-depth/connection-count guess) keeps this portable
// across hardware — the same millisecond budget means the same thing whether Postgres can push
// 2k or 20k logs/sec, whereas a "queue depth of N" threshold tuned on one machine can be wildly
// wrong on another. Half the SLA leaves headroom for the rollup flush and the query side.
const MAX_INSERT_LATENCY_MS = 10_000;
const LATENCY_EWMA_ALPHA = 0.2;
let insertLatencyEwmaMs = 0;

// Shedding never runs an insert, so a shed request produces no new latency sample — without
// a deliberate exception, once the EWMA crosses the threshold nothing could ever bring it back
// down, and the gate would shed every request forever until the process restarts. Letting one
// request through as a "probe" every PROBE_INTERVAL_MS keeps measuring real latency while
// overloaded, so the gate re-opens on its own once Postgres actually catches up.
const PROBE_INTERVAL_MS = 500;
let lastProbeAt = 0;

export class IngestOverloadedError extends Error {}

export async function insertLogs(logs: LogEntry[]): Promise<InsertResult> {
    if (!Array.isArray(logs)) {
        return { accepted: 0, rejected: [{ index: -1, reason: "logs must be an array" }] };
    }

    if (insertLatencyEwmaMs > MAX_INSERT_LATENCY_MS) {
        const now = Date.now();
        if (now - lastProbeAt < PROBE_INTERVAL_MS) {
            throw new IngestOverloadedError();
        }
        lastProbeAt = now;
    }

    const rejected: { index: number; reason: string }[] = [];
    const validRows: (string | null)[][] = [];
    const epochMsList: number[] = [];
    const now = Date.now();

    for (let index = 0; index < logs.length; index++) {
        const log = logs[index]!;
        const result = validateLogEntry(log, now);
        if (!result.valid) {
            rejected.push({ index, reason: result.reason });
            continue;
        }
        validRows.push(result.row);
        epochMsList.push(result.epochMs);
    }

    if (validRows.length > 0) {
        // unnest() sends one array per column instead of N*5 bind parameters, so the query
        // text stays a fixed size regardless of batch size — avoids Postgres re-parsing/
        // re-planning an ever-growing VALUES list on every ingest call.
        const timestamps = validRows.map((r) => r[0]);
        const levels = validRows.map((r) => r[1]);
        const services = validRows.map((r) => r[2]);
        const messages = validRows.map((r) => r[3]);
        const attributes = validRows.map((r) => r[4]);

        const insertStartedAt = Date.now();
        await pool.query({
            // A named statement is parsed/planned once per physical connection and reused
            // on every later call with that name on that connection — this query's shape
            // never changes, so naming it turns every insert after a connection's first
            // into a bind-and-execute, skipping parse/plan CPU on the single-core Postgres
            // container for the hottest query in the service.
            name: "insert_logs",
            text: `INSERT INTO logs (timestamp, level, service, message, attributes)
             SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::jsonb[])`,
            values: [timestamps, levels, services, messages, attributes],
        });
        const insertElapsedMs = Date.now() - insertStartedAt;
        insertLatencyEwmaMs = insertLatencyEwmaMs === 0
            ? insertElapsedMs
            : LATENCY_EWMA_ALPHA * insertElapsedMs + (1 - LATENCY_EWMA_ALPHA) * insertLatencyEwmaMs;

        // Rollup deltas for GET /logs/aggregate's fast path are grouped here but not
        // written yet — see accumulateRollup/flushRollup in ./rollup.js. Writing them on
        // every request added enough per-request DB round-trip cost to meaningfully cut
        // ingestion throughput; batching them in memory and flushing on a timer keeps
        // that cost off the request path entirely.
        for (let i = 0; i < validRows.length; i++) {
            const bucketMs = epochMsList[i]! - (epochMsList[i]! % MINUTE_MS);
            accumulateRollup(bucketMs, services[i] as string, levels[i] as string, 1);
        }
    }

    return { accepted: validRows.length, rejected };
}
