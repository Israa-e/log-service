import { readFileSync } from "fs";
import { pool } from "./index.js";

export async function migrate(): Promise<void> {
  const schema = readFileSync(new URL("schema.sql", import.meta.url), "utf-8");
  await pool.query(schema);

  await pool.query(
    "SELECT create_hypertable('logs', 'timestamp', if_not_exists => TRUE, migrate_data => TRUE)"
  );

  const indexes = readFileSync(new URL("indexes.sql", import.meta.url), "utf-8");
  await pool.query(indexes);

  console.log("Migration complete");
}
