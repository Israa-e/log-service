import { pool } from "../db/index.js";
import { createNotification } from "./notificationService.js";
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || "30", 10);

export async function runRetention() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // drop_chunks only removes chunks fully older than `cutoff`, so a chunk straddling the
  // boundary survives. Count rows first for reporting purposes — the count can therefore be a
  // slight overestimate of what actually gets dropped, bounded by one chunk_time_interval.
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM logs WHERE timestamp < $1`,
    [cutoff.toISOString()]
  );
  const totalDeleted = parseInt(countResult.rows[0].count, 10);

  await pool.query(`SELECT drop_chunks('logs', older_than => $1::timestamptz)`, [
    cutoff.toISOString(),
  ]);

  // logs_rollup_1m is a separate hypertable (the continuous aggregate's materialized
  // storage) — dropping chunks from `logs` doesn't touch it, so without this it would
  // grow unbounded regardless of RETENTION_DAYS.
  await pool.query(`SELECT drop_chunks('logs_rollup_1m', older_than => $1::timestamptz)`, [
    cutoff.toISOString(),
  ]);

  if (totalDeleted > 0) {
    createNotification("retention", "Retention Run Complete", `Deleted ${totalDeleted} logs older than ${RETENTION_DAYS} days`);
    console.log(`Retention: dropped chunks containing ~${totalDeleted} old logs`);
  }

  return totalDeleted;
}

export function startRetentionJob(intervalMs: number = 60 * 60 * 1000) {
  runRetention().catch((err) => console.error("Retention error:", err));

  setInterval(() => {
    runRetention().catch((err) => console.error("Retention error:", err));
  }, intervalMs);
}