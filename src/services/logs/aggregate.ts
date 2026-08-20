import { queryPool } from "../../db/index.js";
import { VALID_LEVELS } from "./validation.js";
import { BUCKET_INTERVAL_MS, mergePendingRollupIntoBuckets } from "./rollup.js";

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
