import { readFileSync } from "fs";
import { pool } from "./index.js";
import { hashPassword } from "../services/passwordService.js";

async function seedAdminUser(): Promise<void> {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || process.env.DASHBOARD_PASSWORD || "admin123";
  const passwordHash = await hashPassword(password);

  await pool.query(
    `INSERT INTO users (username, password_hash) VALUES ($1, $2)
     ON CONFLICT (username) DO NOTHING`,
    [username, passwordHash]
  );
}

export async function migrate(): Promise<void> {
  const schema = readFileSync(new URL("schema.sql", import.meta.url), "utf-8");
  await pool.query(schema);

  await pool.query(
    "SELECT create_hypertable('logs', 'timestamp', if_not_exists => TRUE, migrate_data => TRUE)"
  );

  const indexes = readFileSync(new URL("indexes.sql", import.meta.url), "utf-8");
  await pool.query(indexes);

  await setupRollup();
  await seedAdminUser();

  console.log("Migration complete");
}

// /logs/aggregate's primary (unfiltered-by-attr/q) query path reads from this 1-minute
// rollup instead of scanning raw rows, so aggregate latency stays flat regardless of how
// many rows are in the queried range. The recurring policy only ever refreshes a window
// near "now" (bounded by start_offset), so it will never backfill older data whose own
// timestamp already fell outside that window before the policy started running — e.g. a
// pre-seeded historical dataset. We handle that once, here, with a full manual refresh
// the first time the view has no data; after that, the policy keeps it current.
//
// materialized_only=true disables real-time aggregation (which would otherwise UNION
// the rollup with a live scan over not-yet-refreshed raw rows on every query). Without
// it, that live scan contends with concurrent inserts on the same active chunk and
// produces multi-second latency spikes under load. With a 10s refresh policy, this
// bounds staleness to ~10-20s, within the API contract's 20s visibility window.
async function setupRollup(): Promise<void> {
  await pool.query(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS logs_rollup_1m
    WITH (timescaledb.continuous, timescaledb.materialized_only = true) AS
    SELECT
      time_bucket('1 minute', timestamp) AS bucket_start,
      service,
      level,
      count(*) AS count
    FROM logs
    GROUP BY bucket_start, service, level
    WITH NO DATA
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM timescaledb_information.jobs
        WHERE hypertable_name = 'logs_rollup_1m'
          AND proc_name = 'policy_refresh_continuous_aggregate'
      ) THEN
        PERFORM add_continuous_aggregate_policy('logs_rollup_1m',
          start_offset => INTERVAL '1 hour',
          end_offset => INTERVAL '10 seconds',
          schedule_interval => INTERVAL '10 seconds');
      END IF;
    END $$;
  `);

  const { rows } = await pool.query(`SELECT count(*) FROM logs_rollup_1m`);
  if (parseInt(rows[0].count, 10) === 0) {
    await pool.query(`CALL refresh_continuous_aggregate('logs_rollup_1m', NULL, NULL)`);
  }
}
