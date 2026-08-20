import { pool } from "../../db/index.js";
import { validateLogEntry } from "./validation.js";
import { accumulateRollup, MINUTE_MS } from "./rollup.js";
import type { LogEntry, InsertResult } from "./types.js";

export async function insertLogs(logs: LogEntry[]): Promise<InsertResult> {
    if (!Array.isArray(logs)) {
        return { accepted: 0, rejected: [{ index: -1, reason: "logs must be an array" }] };
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

        await pool.query(
            `INSERT INTO logs (timestamp, level, service, message, attributes)
             SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::jsonb[])`,
            [timestamps, levels, services, messages, attributes]
        );

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
