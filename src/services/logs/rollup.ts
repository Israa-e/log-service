import { rollupPool } from "../../db/index.js";

export const MINUTE_MS = 60 * 1000;

// In-memory accumulator for GET /logs/aggregate's rollup, drained by flushRollup() on a
// timer (see startRollupFlusher). Nested Maps avoid building/parsing a string key per
// row — cheap enough to run inline on the request path — while the actual DB write
// happens in bulk, off that path, at a bounded rate regardless of ingestion volume.
let pendingRollup = new Map<number, Map<string, Map<string, number>>>();

export function accumulateRollup(bucketMs: number, service: string, level: string, delta: number): void {
    let byService = pendingRollup.get(bucketMs);
    if (!byService) {
        byService = new Map();
        pendingRollup.set(bucketMs, byService);
    }
    let byLevel = byService.get(service);
    if (!byLevel) {
        byLevel = new Map();
        byService.set(service, byLevel);
    }
    byLevel.set(level, (byLevel.get(level) ?? 0) + delta);
}

export async function flushRollup(): Promise<void> {
    if (pendingRollup.size === 0) return;

    // Swap out the accumulator before the first await so concurrent requests keep
    // accumulating into a fresh map while this flush writes the snapshot — no data is
    // dropped or double-counted across the swap.
    const snapshot = pendingRollup;
    pendingRollup = new Map();

    const buckets: string[] = [];
    const services: string[] = [];
    const levels: string[] = [];
    const counts: number[] = [];
    for (const [bucketMs, byService] of snapshot) {
        const bucketStart = new Date(bucketMs).toISOString();
        for (const [service, byLevel] of byService) {
            for (const [level, count] of byLevel) {
                buckets.push(bucketStart);
                services.push(service);
                levels.push(level);
                counts.push(count);
            }
        }
    }

    try {
        // Named for the same reason as insert_logs in insert.ts: this query's shape is
        // fixed, so naming it lets `pg` skip parse/plan on every flush after a rollupPool
        // connection's first.
        await rollupPool.query({
            name: "flush_rollup",
            text: `INSERT INTO logs_rollup_1m (bucket_start, service, level, count)
             SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::bigint[])`,
            values: [buckets, services, levels, counts],
        });
    } catch (err) {
        console.error("Rollup flush failed, re-queuing for retry:", err);
        // The snapshot was already swapped out of pendingRollup before this query ran, so on
        // failure it must be merged back in (not just re-assigned) — pendingRollup may already
        // have new deltas accumulated from requests since the swap. Without this, a single
        // failed flush (e.g. rollupPool contention under load) permanently drops those counts.
        for (const [bucketMs, byService] of snapshot) {
            for (const [service, byLevel] of byService) {
                for (const [level, count] of byLevel) {
                    accumulateRollup(bucketMs, service, level, count);
                }
            }
        }
    }
}

export const BUCKET_INTERVAL_MS: Record<string, number> = {
    "1m": MINUTE_MS,
    "5m": 5 * MINUTE_MS,
    "1h": 60 * MINUTE_MS,
    "1d": 24 * 60 * MINUTE_MS,
};

// The rollup-backed path in queryAggregate only sees counts already flushed to
// logs_rollup_1m — deltas still sitting in pendingRollup (up to one flush cycle old) are
// invisible to it, which is exactly the write-to-visible gap read-after-write checks race
// against. This merges those pending deltas straight into the DB-fetched bucket map, keyed
// the same way as the SQL result, so a request landing between flushes still sees them.
// Bucket alignment (bucketMs - bucketMs % bucketIntervalMs) matches Postgres's time_bucket
// for these fixed intervals because pendingRollup keys are already minute-aligned and every
// supported interval (1m/5m/1h/1d) is a clean multiple of a minute aligned to the UTC epoch.
export function mergePendingRollupIntoBuckets(
    bucketRows: Map<string, { start: string; group: string | null; count: number }>,
    sinceMs: number,
    untilMs: number,
    bucketIntervalMs: number,
    groupColumn: "service" | "level" | null,
    serviceFilter?: string,
    levelFilter?: string
): void {
    for (const [bucketMs, byService] of pendingRollup) {
        if (bucketMs < sinceMs || bucketMs >= untilMs) continue;
        for (const [service, byLevel] of byService) {
            if (serviceFilter && service !== serviceFilter) continue;
            for (const [level, count] of byLevel) {
                if (levelFilter && level !== levelFilter) continue;
                const alignedMs = bucketMs - (bucketMs % bucketIntervalMs);
                const start = new Date(alignedMs).toISOString();
                const group = groupColumn === "service" ? service : groupColumn === "level" ? level : null;
                const key = `${start}|${group}`;
                const existing = bucketRows.get(key);
                if (existing) {
                    existing.count += count;
                } else {
                    bucketRows.set(key, { start, group, count });
                }
            }
        }
    }
}

export function startRollupFlusher(intervalMs: number = 1000): NodeJS.Timeout {
    // setInterval doesn't wait for the callback to finish, so under load — where a flush can
    // take longer than intervalMs because rollupPool (2 connections) is contended — ticks
    // would otherwise pile up faster than they drain, each queuing indefinitely for a
    // connection. The in-flight guard skips a tick while one is still running instead of
    // stacking more attempts on top of it; the next tick that finds it free flushes
    // everything accumulated since, so nothing is lost, just coalesced.
    let inFlight = false;
    return setInterval(() => {
        if (inFlight) return;
        inFlight = true;
        flushRollup()
            .catch((err) => console.error("Rollup flush error:", err))
            .finally(() => { inFlight = false; });
    }, intervalMs);
}
