import { pool } from "../db/index.js";

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
  | { valid: true; row: (string | null)[] }
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
    };
}

export async function insertLogs(logs: LogEntry[]): Promise<InsertResult> {
    if (!Array.isArray(logs)) {
        return { accepted: 0, rejected: [{ index: -1, reason: "logs must be an array" }] };
    }

    const rejected: { index: number; reason: string }[] = [];
    const validRows: (string | null)[][] = [];
    const now = Date.now();

    for (let index = 0; index < logs.length; index++) {
        const log = logs[index]!;
        const result = validateLogEntry(log, now);
        if (!result.valid) {
            rejected.push({ index, reason: result.reason });
            continue;
        }
        validRows.push(result.row);
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

    const result = await pool.query(querySql, values);

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

    const conditions: string[] = [`timestamp >= $1`, `timestamp < $2`];
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

    const whereClause = conditions.join(" AND ");
    const groupColumn = group_by === "service" ? "service" : group_by === "level" ? "level" : null;

    const selectGroup = groupColumn ? `${groupColumn} AS group_value` : `NULL AS group_value`;
    const groupByClause = groupColumn
        ? `GROUP BY bucket_start, ${groupColumn}`
        : `GROUP BY bucket_start`;

    const sql = `
    SELECT
      time_bucket('${bucketInterval}', timestamp) AS bucket_start,
      ${selectGroup},
      COUNT(*) AS count
    FROM logs
    WHERE ${whereClause}
    ${groupByClause}
    ORDER BY bucket_start ASC
  `;

    const result = await pool.query(sql, values);

    const buckets = result.rows.map((row) => ({
        start: row.bucket_start,
        group: row.group_value,
        count: parseInt(row.count, 10),
    }));

    return { buckets };
}