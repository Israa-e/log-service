import { pool } from "../db/index.js";
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || "30", 10);
const BATCH_SIZE = 1000;
export async function runRetention() {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let totalDeleted = 0;
    while(true){
        const result = await pool.query(
      `DELETE FROM logs
       WHERE (id, timestamp) IN (
         SELECT id, timestamp FROM logs
         WHERE timestamp < $1
         LIMIT $2
       )`,
      [cutoff.toISOString(), BATCH_SIZE]
    );   const deletedCount = result.rowCount || 0;
    totalDeleted += deletedCount;

    if (deletedCount < BATCH_SIZE) break; // خلصنا، ما ضل شي أقدم من الحد
  }

  if (totalDeleted > 0) {
    console.log(`Retention: deleted ${totalDeleted} old logs`);
  }

  return totalDeleted;
    
}

export function startRetentionJob(intervalMs: number = 60 * 60 * 1000) {
  runRetention().catch((err) => console.error("Retention error:", err));

  setInterval(() => {
    runRetention().catch((err) => console.error("Retention error:", err));
  }, intervalMs);
}