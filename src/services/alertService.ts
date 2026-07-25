import { pool } from "../db/index.js";
export async function checkAlerts() {
      const rules = await pool.query(`SELECT * FROM alert_rules`);

  for (const rule of rules.rows) {
    const conditions = [`level = 'error'`, `timestamp >= NOW() - ($1 || ' minutes')::interval`];
    const values: any[] = [rule.window_minutes];

    if (rule.service) {
      conditions.push(`service = $2`);
      values.push(rule.service);
    }

    const result = await pool.query(
      `SELECT COUNT(*) FROM logs WHERE ${conditions.join(" AND ")}`,
      values
    );

    const errorCount = parseInt(result.rows[0].count, 10);

    if (errorCount >= rule.threshold) {
      // ما نكرر نفس التنبيه إذا صار بآخر 10 دقايق
      if (rule.last_triggered_at) {
        const minutesSinceLastTrigger =
          (Date.now() - new Date(rule.last_triggered_at).getTime()) / (60 * 1000);
        if (minutesSinceLastTrigger < 10) continue;
      }

      try {
        await fetch(rule.webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            alert: "error_threshold_exceeded",
            service: rule.service || "all",
            error_count: errorCount,
            threshold: rule.threshold,
            window_minutes: rule.window_minutes,
            triggered_at: new Date().toISOString(),
          }),
        });

        await pool.query(`UPDATE alert_rules SET last_triggered_at = NOW() WHERE id = $1`, [
          rule.id,
        ]);

        console.log(`Alert triggered for rule ${rule.id}: ${errorCount} errors`);
      } catch (err) {
        console.error(`Failed to send webhook for rule ${rule.id}:`, err);
      }
    }
  }
}


export function startAlertJob(intervalMs: number = 60 * 1000) {
  setInterval(() => {
    checkAlerts().catch((err) => console.error("Alert check error:", err));
  }, intervalMs);
}


export async function createAlertRule(rule: {
  service?: string;
  threshold: number;
  window_minutes: number;
  webhook_url: string;
}) {
  if (!rule.threshold || !rule.window_minutes || !rule.webhook_url) {
    throw new Error("threshold, window_minutes, and webhook_url are required");
  }

  const result = await pool.query(
    `INSERT INTO alert_rules (service, threshold, window_minutes, webhook_url)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [rule.service || null, rule.threshold, rule.window_minutes, rule.webhook_url]
  );

  return result.rows[0];
}