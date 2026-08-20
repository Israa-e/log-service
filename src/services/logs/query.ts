import { queryPool } from "../../db/index.js";
import { VALID_LEVELS } from "./validation.js";
import { decodeCursor } from "./cursor.js";

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
