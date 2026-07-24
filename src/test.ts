import express from "express";
import { pool } from "./db/index.js";
const app = express()
const PORT = 8080;

app.use(express.json())
const VALD_LEVELS = ["debug", "info", "warn", "error"]
app.get("/health", (req, res) => {
    res.status(200).send("OK")
});
app.post("/logs", (req, res) => {
    const logs = req.body.logs;
    if (!Array.isArray(logs)) {
        return res.status(400).json({ error: "log must be an array" })
    }
    const rejected: { index: number; reason: string }[] = [];
    let accepted = 0;
    logs.forEach((log, index) => {
        const time = new Date(log.timestamp);
        if (isNaN(time.getTime())) {
            rejected.push({ index, reason: "invalid timestamp" });
            return;
        }
        const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;
        if (time.getTime() > fiveMinutesFromNow) {
            rejected.push({ index, reason: "timestamp too far in the future" })
            return
        }

        if (!VALD_LEVELS.includes(log.level)) {
            rejected.push({ index, reason: `invalid level: '${log.level}'` })
            return
        }
        if (typeof log.service !== "string" || log.service.trim() === "") {
            rejected.push({ index, reason: "service is required" })
            return
        }
        if (typeof log.message !== "string" || log.message.trim() === "") {
            rejected.push({ index, reason: "message is required" })
            return
        }



        pool.query(`INSERT INTO logs (timestamp, level, service, message, attributes)
       VALUES ($1, $2, $3, $4, $5)`, [
            log.timestamp,
            log.level,
            log.service,
            log.message,
            log.attributes ? JSON.stringify(log.attributes) : null,
        ]);
        accepted++;


    });

    if (accepted === 0) {
        return res.status(400).json({ accepted: 0, rejected })
    }
    res.status(200).json({ accepted, rejected })
});

app.get("/logs", async (req, res) => {
    const { service, level, since, until, q, cursor } = req.query;
    let limit = 100;
    if (req.query.limit) {
        const parsedLimit = parseInt(req.query.limit as string, 10);
        if (isNaN(parsedLimit)) {
            return res.status(400).json({ error: "limit must be a number" });
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
        const sincDate = new Date(since as string);
        if (isNaN(sincDate.getTime())) {
            return res.status(400).json({ error: "invalid 'since' timestamp" });
        }
        conditions.push(`timestamp >= $${paramIndex}`);
        values.push(sincDate.toISOString());
        paramIndex++;
    }
    if (until) {
        const untilDate = new Date(until as string);
        if (isNaN(untilDate.getTime())) {
            return res.status(400).json({ error: "invalid 'until' timestamp" });
        }
        conditions.push(`timestamp < $${paramIndex}`);
        values.push(untilDate.toISOString());
        paramIndex++;
    }
    if (q) {
        conditions.push(`message ILIKE $${paramIndex}`);
        values.push(`%${q}%`);
        paramIndex++;
    }

    for (const key in req.query) {
        if (key.startsWith("attr.")) {
            const attrKey = key.slice(5);
            conditions.push(`attributes ->> $${paramIndex} = $${paramIndex + 1}`);
            values.push(attrKey, req.query[key] as string);
            paramIndex += 2;
        }
    }
    if (cursor) {
        try {
            const decoded = JSON.parse(Buffer.from(cursor as string, "base64").toString())
            conditions.push(`(timestamp, id) < ($${paramIndex}, $${paramIndex + 1})`);
            values.push(decoded.timestamp, decoded.id);
            paramIndex += 2;

        } catch (error) {
            return res.status(400).json({ error: "invalid cursor" });

        }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const query = `
    SELECT * FROM logs
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT ${limit}
  `;
    const result = await pool.query(query, values);
    let nextCursor = null;
    if (result.rows.length === limit) {
        const lastRow = result.rows[result.rows.length - 1];
        nextCursor = Buffer.from(JSON.stringify({ timestamp: lastRow.timestamp, id: lastRow.id })).toString("base64");
    }
    res.status(200).json({
        logs: result.rows,
        next_cursor: nextCursor,
    })

})


app.get("/logs/aggregate", async (req, res) => {
    const { service, level, since, until, q, group_by, bucket } = req.query;
    if (!since || !until) {
        return res.status(400).json({
            error: "since and until are required"
        });
    } const validBuckets = ["1m", "5m", "1h", "1d"];
    if (!bucket || !validBuckets.includes(bucket as string)) {
        return res.status(400).json({
            error: "invalid bucket"
        });
    }
    if (
        group_by &&
        group_by !== "service" &&
        group_by !== "level"
    ) {
        return res.status(400).json({
            error: "invalid group_by"
        });
    }
    const sinceDate = new Date(since as string);
    const untilDate = new Date(until as string);
    if (
        isNaN(sinceDate.getTime()) ||
        isNaN(untilDate.getTime())
    ) {
        return res.status(400).json({
            error: "invalid timestamp"
        });
    }

    if (untilDate <= sinceDate) {
        return res.status(400).json({
            error: "until must be after since"
        });
    }
    let bucketExpression = "";

    switch (bucket) {
        case "1m":
            bucketExpression = "1 minute";
            break;

        case "5m":
            bucketExpression = "5 minutes";
            break;

        case "1h":
            bucketExpression = "1 hour";
            break;

        case "1d":
            bucketExpression = "1 day";
            break;
    }
    const conditions: string[] = [
        `timestamp >= $1`,
        `timestamp < $2`
    ];

    const values: any[] = [
        sinceDate.toISOString(),
        untilDate.toISOString()
    ];

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


    let groupColumn = "NULL";

    if (group_by === "service") {
        groupColumn = "service";
    }

    if (group_by === "level") {
        groupColumn = "level";
    }


    const query = `
    SELECT
        date_bin(
            '${bucketExpression}',
            timestamp,
            TIMESTAMP '2001-01-01'
        ) AS start,
        ${groupColumn} AS group,
        COUNT(*)::int AS count
    FROM logs
    WHERE ${conditions.join(" AND ")}
    GROUP BY start ${groupColumn !== "NULL" ? `, ${groupColumn}` : ""}
    ORDER BY start ASC;
`;

    const result = await pool.query(query, values);


    res.json({
        buckets: result.rows
    });
})

app.listen(PORT, () => {
    console.log(`السيرفر شغال على port ${PORT}`)
});
