import { pool, queryPool, rollupPool } from "../db/index.js";

const VALID_LEVELS = ["debug", "info", "warn", "error"];

interface LogEntry {
  timestamp: string;
  level: string;
  service: string;
  message: string;
  attributes?: Record<string, string | number | boolean>;
}

interface InsertResult {
  accepted: number;
  rejected: { index: number; reason: string }[];
}

type ValidationResult =
  | { valid: true; row: (string | null)[]; epochMs: number }
  | { valid: false; reason: string };

export function decodeCursor(cursor: string): { timestamp: string; id: number } {
    let decoded: { timestamp: string; id: number };
    try {
        decoded = JSON.parse(Buffer.from(cursor, "base64").toString());
    } catch {
        throw new Error("invalid cursor");
    }

    if (!decoded || typeof decoded.timestamp !== "string" || typeof decoded.id !== "number") {
        throw new Error("invalid cursor");
    }

    return decoded;
}

function normalizeAttributes(attributes: Record<string, string | number | boolean>) {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(attributes)) {
        if (value === null || value === undefined) {
            throw new Error(`invalid attribute value for '${key}'`);
        }
        if (typeof value === "object") {
            throw new Error(`nested object in attribute '${key}'`);
        }
        normalized[key] = String(value);
    }
    return normalized;
}

export function validateLogEntry(log: LogEntry, now: number = Date.now()): ValidationResult {
    if (typeof log !== "object" || log === null || Array.isArray(log)) {
        return { valid: false, reason: "entry must be an object" };
    }

    if (!log.timestamp) {
        return { valid: false, reason: "timestamp is required" };
    }

    const ts = log.timestamp;
    const time = new Date(ts);
    if (isNaN(time.getTime())) {
        return { valid: false, reason: "invalid timestamp" };
    }

    const fiveMinutesFromNow = now + 5 * 60 * 1000;
    if (time.getTime() > fiveMinutesFromNow) {
        return { valid: false, reason: "timestamp too far in the future" };
    }

    if (!VALID_LEVELS.includes(log.level)) {
        return { valid: false, reason: `invalid level: '${log.level}'` };
    }

    if (typeof log.service !== "string" || log.service.trim() === "") {
        return { valid: false, reason: "service is required" };
    }

    if (typeof log.message !== "string" || log.message.trim() === "") {
        return { valid: false, reason: "message is required" };
    }

    let normalizedAttributes: string | null = null;
    if (log.attributes != null) {
        if (typeof log.attributes !== "object" || Array.isArray(log.attributes)) {
            return { valid: false, reason: "attributes must be a flat object" };
        }
        try {
            normalizedAttributes = JSON.stringify(normalizeAttributes(log.attributes));
        } catch (error: any) {
            return { valid: false, reason: error.message };
        }
    }

    return {
        valid: true,
        row: [ts, log.level, log.service, log.message, normalizedAttributes],
        epochMs: time.getTime(),
    };
}

const MINUTE_MS = 60 * 1000;

// In-memory accumulator for GET /logs/aggregate's rollup, drained by flushRollup() on a
// timer (see startRollupFlusher). Nested Maps avoid building/parsing a string key per
// row — cheap enough to run inline on the request path — while the actual DB write
// happens in bulk, off that path, at a bounded rate regardless of ingestion volume.
let pendingRollup = new Map<number, Map<string, Map<string, number>>>();

function accumulateRollup(bucketMs: number, service: string, level: string, delta: number): void {
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
        await rollupPool.query(
            `INSERT INTO logs_rollup_1m (bucket_start, service, level, count)
             SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::bigint[])`,
            [buckets, services, levels, counts]
        );
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

const BUCKET_INTERVAL_MS: Record<string, number> = {
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
function mergePendingRollupIntoBuckets(
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
        // written yet — see accumulateRollup/flushRollup below. Writing them on every
        // request added enough per-request DB round-trip cost to meaningfully cut
        // ingestion throughput; batching them in memory and flushing on a timer keeps
        // that cost off the request path entirely.
        for (let i = 0; i < validRows.length; i++) {
            const bucketMs = epochMsList[i]! - (epochMsList[i]! % MINUTE_MS);
            accumulateRollup(bucketMs, services[i] as string, levels[i] as string, 1);
        }
    }

    return { accepted: validRows.length, rejected };
}

export async function queryLogs(query: any) {
    const { service, level, since, until, q, cursor } = query;

    if (level) {
        const levels = level.split(",");
        for (const lvl of levels) {
            if (!VALID_LEVELS.includes(lvl)) {
                throw new Error(`invalid level: '${lvl}'`);
            }
        }
    }

    let limit = 100;
    if (query.limit) {
        const parsedLimit = Number(query.limit);
        if (!Number.isInteger(parsedLimit)) {
            throw new Error("limit must be a number");
        }
        if (parsedLimit < 1 || parsedLimit > 1000) {
            throw new Error("limit must be between 1 and 1000");
        }
        limit = parsedLimit;
    }

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    let sinceDate: Date | undefined;
    let untilDate: Date | undefined;

    if (service) {
        conditions.push(`service = $${paramIndex}`);
        values.push(service);
        paramIndex++;
    }

    if (level) {
        const levels = level.split(",");
        conditions.push(`level = ANY($${paramIndex}::text[])`);
        values.push(levels);
        paramIndex++;
    }

    if (since) {
        sinceDate = new Date(since);
        if (isNaN(sinceDate.getTime())) throw new Error("invalid 'since' timestamp");
        conditions.push(`timestamp >= $${paramIndex}`);
        values.push(sinceDate.toISOString());
        paramIndex++;
    }

    if (until) {
        untilDate = new Date(until);
        if (isNaN(untilDate.getTime())) throw new Error("invalid 'until' timestamp");
        conditions.push(`timestamp < $${paramIndex}`);
        values.push(untilDate.toISOString());
        paramIndex++;
    }

    if (sinceDate && untilDate && untilDate <= sinceDate) {
        throw new Error("'until' must be after 'since'");
    }

    if (q) {
        conditions.push(`message ILIKE $${paramIndex}`);
        values.push(`%${q}%`);
        paramIndex++;
    }

    for (const key in query) {
        if (key.startsWith("attr.")) {
            const attrKey = key.slice(5);
            conditions.push(`attributes @> $${paramIndex}::jsonb`);
            values.push(JSON.stringify({ [attrKey]: String(query[key]) }));
            paramIndex += 1;
        }
    }

    if (cursor) {
        const decoded = decodeCursor(cursor);
        conditions.push(`(timestamp, id) < ($${paramIndex}, $${paramIndex + 1})`);
        values.push(decoded.timestamp, decoded.id);
        paramIndex += 2;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const querySql = `SELECT * FROM logs ${whereClause} ORDER BY timestamp DESC, id DESC LIMIT ${limit}`;

    const result = await queryPool.query(querySql, values);

    const total = null;

    let nextCursor = null;
    if (result.rows.length === limit) {
        const lastRow = result.rows[result.rows.length - 1];
        nextCursor = Buffer.from(
            JSON.stringify({ timestamp: lastRow.timestamp, id: lastRow.id })
        ).toString("base64");
    }

    return { logs: result.rows, total, next_cursor: nextCursor };
}
export async function queryAggregate(query: any) {
    const { service, level, since, until, q, bucket, group_by } = query;

    if (!since || !until) {
        throw new Error("'since' and 'until' are required");
    }
    if (!bucket) {
        throw new Error("'bucket' is required");
    }

    const bucketMap: Record<string, string> = {
        "1m": "1 minute",
        "5m": "5 minutes",
        "1h": "1 hour",
        "1d": "1 day",
    };
    const bucketInterval = bucketMap[bucket];
    if (!bucketInterval) {
        throw new Error("bucket must be one of: 1m, 5m, 1h, 1d");
    }

    if (group_by && group_by !== "service" && group_by !== "level") {
        throw new Error("group_by must be 'service' or 'level'");
    }

    const sinceDate = new Date(since);
    const untilDate = new Date(until);
    if (isNaN(sinceDate.getTime()) || isNaN(untilDate.getTime())) {
        throw new Error("invalid 'since' or 'until' timestamp");
    }
    if (untilDate <= sinceDate) {
        throw new Error("'until' must be after 'since'");
    }

    if (level && !VALID_LEVELS.includes(level)) {
        throw new Error(`invalid level: '${level}'`);
    }

    const attrFilters = Object.keys(query).filter((key) => key.startsWith("attr."));
    const groupColumn = group_by === "service" ? "service" : group_by === "level" ? "level" : null;
    const selectGroup = groupColumn ? `${groupColumn} AS group_value` : `NULL AS group_value`;

    // attr.<key> and q filters aren't tracked by the rollup (it only retains service/level/
    // count per minute), so those queries fall back to scanning raw rows. Everything else —
    // the primary aggregation path — reads pre-aggregated per-minute counts instead, so
    // latency stays flat regardless of how many raw rows fall in the queried range.
    const useRollup = attrFilters.length === 0 && !q;

    const conditions: string[] = [`bucket_start >= $1`, `bucket_start < $2`];
    const values: any[] = [sinceDate.toISOString(), untilDate.toISOString()];
    let paramIndex = 3;

    if (service) {
        conditions.push(`service = $${paramIndex}`);
        values.push(service);
        paramIndex++;
    }

    if (level) {
        conditions.push(`level = $${paramIndex}`);
        values.push(level);
        paramIndex++;
    }

    let sql: string;

    if (useRollup) {
        const whereClause = conditions.join(" AND ");
        const groupByClause = groupColumn ? `GROUP BY bucket, ${groupColumn}` : `GROUP BY bucket`;
        sql = `
      SELECT
        time_bucket('${bucketInterval}', bucket_start) AS bucket,
        ${selectGroup},
        SUM(count) AS count
      FROM logs_rollup_1m
      WHERE ${whereClause}
      ${groupByClause}
      ORDER BY bucket ASC
    `;
    } else {
        // raw-scan fallback for attr.*/q filtered aggregate queries
        conditions[0] = `timestamp >= $1`;
        conditions[1] = `timestamp < $2`;

        if (q) {
            conditions.push(`message ILIKE $${paramIndex}`);
            values.push(`%${q}%`);
            paramIndex++;
        }

        for (const key of attrFilters) {
            const attrKey = key.slice(5);
            conditions.push(`attributes @> $${paramIndex}::jsonb`);
            values.push(JSON.stringify({ [attrKey]: String(query[key]) }));
            paramIndex += 1;
        }

        const whereClause = conditions.join(" AND ");
        const groupByClause = groupColumn ? `GROUP BY bucket, ${groupColumn}` : `GROUP BY bucket`;
        sql = `
      SELECT
        time_bucket('${bucketInterval}', timestamp) AS bucket,
        ${selectGroup},
        COUNT(*) AS count
      FROM logs
      WHERE ${whereClause}
      ${groupByClause}
      ORDER BY bucket ASC
    `;
    }

    const result = await queryPool.query(sql, values);

    const bucketRows = new Map<string, { start: string; group: string | null; count: number }>();
    for (const row of result.rows) {
        const start = new Date(row.bucket).toISOString();
        bucketRows.set(`${start}|${row.group_value}`, {
            start,
            group: row.group_value,
            count: parseInt(row.count, 10),
        });
    }

    if (useRollup) {
        mergePendingRollupIntoBuckets(
            bucketRows,
            sinceDate.getTime(),
            untilDate.getTime(),
            BUCKET_INTERVAL_MS[bucket]!,
            groupColumn,
            service,
            level
        );
    }

    const buckets = Array.from(bucketRows.values()).sort(
        (a, b) => Date.parse(a.start) - Date.parse(b.start)
    );

    return { buckets };
}