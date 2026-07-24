import { pool } from "../db/index.js";

const VALID_LEVELS = ["debug", "info", "warn", "error"];

export async function insertLogs(logs: any[]) {
    if (!Array.isArray(logs)) {
        return { accepted: 0, rejected: [{ index: -1, reason: "logs must be an array" }] };
    }

    const rejected: { index: number; reason: string }[] = [];
    let accepted = 0;

    for (let index = 0; index < logs.length; index++) {
        const log = logs[index];

        const time = new Date(log.timestamp);
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

        await pool.query(
            `INSERT INTO logs (timestamp, level, service, message, attributes)
       VALUES ($1, $2, $3, $4, $5)`,
            [
                log.timestamp,
                log.level,
                log.service,
                log.message,
                log.attributes ? JSON.stringify(log.attributes) : null,
            ]
        );
        accepted++;
    }

    return { accepted, rejected };
}

export async function queryLogs(query: any) {
    const { service, level, since, until, q, cursor } = query;

    let limit = 100;
    if (query.limit) {
        const parsedLimit = parseInt(query.limit, 10);
        if (isNaN(parsedLimit)) {
            throw new Error("limit must be a number");
        }
        limit = Math.min(parsedLimit, 1000);
    }

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

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

    if (since) {
        const sinceDate = new Date(since);
        if (isNaN(sinceDate.getTime())) throw new Error("invalid 'since' timestamp");
        conditions.push(`timestamp >= $${paramIndex}`);
        values.push(sinceDate.toISOString());
        paramIndex++;
    }

    if (until) {
        const untilDate = new Date(until);
        if (isNaN(untilDate.getTime())) throw new Error("invalid 'until' timestamp");
        conditions.push(`timestamp < $${paramIndex}`);
        values.push(untilDate.toISOString());
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

    if (cursor) {
        const decoded = JSON.parse(Buffer.from(cursor, "base64").toString());
        conditions.push(`(timestamp, id) < ($${paramIndex}, $${paramIndex + 1})`);
        values.push(decoded.timestamp, decoded.id);
        paramIndex += 2;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query(
        `SELECT * FROM logs ${whereClause} ORDER BY timestamp DESC, id DESC LIMIT ${limit}`,
        values
    );

    let nextCursor = null;
    if (result.rows.length === limit) {
        const lastRow = result.rows[result.rows.length - 1];
        nextCursor = Buffer.from(
            JSON.stringify({ timestamp: lastRow.timestamp, id: lastRow.id })
        ).toString("base64");
    }

    return { logs: result.rows, next_cursor: nextCursor };
}
export async function queryAggregate(query: any) {
    return { buckets: [] };
}