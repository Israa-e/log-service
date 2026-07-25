import app from "./app.js";
import { pool } from "./db/index.js";
import { migrate } from "./db/migrate.js";

const PORT = 8080;

async function waitForDb(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("DB not reachable after 60s");
}

async function start(): Promise<void> {
  await waitForDb();
  await migrate();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
