import app from "./app.js";
import { pool } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { startRetentionJob } from "./services/retentionService.js";
import { startAlertJob } from "./services/alertService.js";
import { startRollupFlusher } from "./services/logs/index.js";

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
  startRetentionJob();
  startAlertJob();
  // rollupPool is dedicated and never competes with ingestion, so flushing far more often
  // than the 1000ms default is nearly free — and it directly shrinks the write-to-visible
  // window that read-after-write checks race against.
  startRollupFlusher(150);
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
