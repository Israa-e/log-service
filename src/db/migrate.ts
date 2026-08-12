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

  await seedAdminUser();

  console.log("Migration complete");
}
