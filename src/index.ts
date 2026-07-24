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
app.listen(PORT, () => {
    console.log(`السيرفر شغال على port ${PORT}`)
});
