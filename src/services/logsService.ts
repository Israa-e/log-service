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

export async function insertLogs(logs: LogEntry[]): Promise<InsertResult> {
    if (!Array.isArray(logs)) {
        return { accepted: 0, rejected: [{ index: -1, reason: "logs must be an array" }] };
    }

    const rejected: { index: number; reason: string }[] = [];
    const validRows: (string | null)[][] = [];

    for (let index = 0; index < logs.length; index++) {
        const log = logs[index]!;

        if (!log.timestamp) {
            rejected.push({ index, reason: "timestamp is required" });
            continue;
        }

        const ts = log.timestamp;
        const time = new Date(ts);
        if (isNaN(time.getTime())) {
            rejected.push({ index, reason: "invalid timestamp" });
            continue;
        }

        const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;
        if (time.getTime() > fiveMinutesFromNow) {
            rejected.push({ index, reason: "timestamp too far in the future" });
            continue;
        }

        if (!VALID_LEVELS.includes(log.level)) {
            rejected.push({ index, reason: `invalid level: '${log.level}'` });
            continue;
        }

        if (typeof log.service !== "string" || log.service.trim() === "") {
            rejected.push({ index, reason: "service is required" });
            continue;
        }

        if (typeof log.message !== "string" || log.message.trim() === "") {
            rejected.push({ index, reason: "message is required" });
            continue;
        }

        if (log.attributes != null) {
            let hasNested = false;
            for (const [k, v] of Object.entries(log.attributes)) {
                if (v != null && typeof v === "object") {
                    rejected.push({ index, reason: `nested object in attribute '${k}'` });
                    hasNested = true;
                    break;
                }
            }
            if (hasNested) continue;
        }

        validRows.push([
            ts,
            log.level,
            log.service,
            log.message,
            log.attributes ? JSON.stringify(log.attributes) : null,
        ]);
    }

    if (validRows.length > 0) {
        const placeholders: string[] = [];
        const flatValues: any[] = [];
        let idx = 1;
        for (const row of validRows) {
            placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4})`);
            flatValues.push(row[0], row[1], row[2], row[3], row[4]);
            idx += 5;
        }

        await pool.query(
            `INSERT INTO logs (timestamp, level, service, message, attributes) VALUES ${placeholders.join(", ")}`,
            flatValues
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
        const parsedLimit = parseInt(query.limit, 10);
        if (isNaN(parsedLimit)) {
            throw new Error("limit must be a number");
        }
        limit = Math.min(parsedLimit, 1000);
    }

    let offset = 0;
    if (query.page) {
        const parsedPage = parseInt(query.page, 10);
        if (isNaN(parsedPage) || parsedPage < 1) {
            throw new Error("page must be a positive number");
        }
        offset = (parsedPage - 1) * limit;
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
            conditions.push(`attributes ->> $${paramIndex} = $${paramIndex + 1}`);
            values.push(attrKey, query[key]);
            paramIndex += 2;
        }
    }

    // Capture filters for COUNT(*) before cursor pagination adds parameters
    const filterConditions = [...conditions];
    const filterValues = [...values];

    if (cursor) {
        const decoded = JSON.parse(Buffer.from(cursor, "base64").toString());
        conditions.push(`(timestamp, id) < ($${paramIndex}, $${paramIndex + 1})`);
        values.push(decoded.timestamp, decoded.id);
        paramIndex += 2;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const querySql = cursor
        ? `SELECT * FROM logs ${whereClause} ORDER BY timestamp DESC, id DESC LIMIT ${limit}`
        : `SELECT * FROM logs ${whereClause} ORDER BY timestamp DESC, id DESC LIMIT ${limit} OFFSET ${offset}`;

    const result = await pool.query(querySql, values);

    // Compute total count of filtered logs
    const countWhereClause = filterConditions.length > 0 ? `WHERE ${filterConditions.join(" AND ")}` : "";
    const countResult = await pool.query(
        `SELECT COUNT(*) FROM logs ${countWhereClause}`,
        filterValues
    );
    const total = parseInt(countResult.rows[0].count, 10);

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
            conditions.push(`attributes ->> $${paramIndex} = $${paramIndex + 1}`);
            values.push(attrKey, query[key]);
            paramIndex += 2;
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