/**
 * seed.ts — inserts 1,000,000 log rows for load-testing
 * Usage:  npx tsx scripts/seed.ts
 * Env:    DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME (or defaults below)
 */

import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5433", 10),
  user: process.env.DB_USER || "loguser",
  password: process.env.DB_PASSWORD || "logpass",
  database: process.env.DB_NAME || "logdb",
});

const SERVICES = ["checkout", "auth", "inventory-api", "payment-gateway", "frontend-web", "worker-node", "proxy-ingress", "database-master"];
const LEVELS   = ["debug", "info", "info", "info", "warn", "warn", "error"] as const;

const MESSAGES_BY_LEVEL: Record<string, string[]> = {
  debug: [
    "DB query executed in 2.3ms",
    "Cache hit for key: user_1234",
    "Webhook POST queued to stripe.com",
    "GC paused for 14ms",
    "Header X-Request-ID: req-a1b2c3",
  ],
  info: [
    "User session validated successfully",
    "Hydration completed",
    "Config reload triggered via SIGHUP",
    "Key rotation triggered for vault",
    "New OAuth2 grant issued for client_id: mobile-android",
  ],
  warn: [
    "DB connection pool nearing capacity (92/100 active)",
    "Client connection latency exceeded 350ms",
    "Read-only mode engaged due to disk pressure (>95%)",
    "Cache miss — re-fetching from Postgres cluster",
    "Request rate-limited for IP 203.0.113.42",
  ],
  error: [
    "Payment declined — card insufficient funds",
    "Failed to process transaction: upstream timeout",
    "OOM Killer terminated process",
    "Connection refused to upstream service",
    "Disk usage at 97% — automatic cleanup initiated",
  ],
};

const TOTAL_ROWS  = 1_000_000;
const BATCH_SIZE  = 1_000;

function randomElement<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randomTimestamp(): Date {
  const msAgo = Math.random() * 30 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - msAgo);
}

function randomAttributes(service: string): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {
    region: randomElement(["us-east-1", "eu-west-1", "ap-southeast-1"]),
    request_id: `req-${Math.random().toString(36).slice(2, 10)}`,
  };
  if (Math.random() > 0.5) attrs["user_id"] = String(Math.floor(Math.random() * 10000));
  if (Math.random() > 0.6) attrs["duration_ms"] = Math.floor(Math.random() * 5000);
  if (service === "checkout" || service === "payment-gateway") {
    attrs["transaction_id"] = `TX-${Math.floor(Math.random() * 99999)}`;
  }
  return attrs;
}

async function seed() {
  console.log(`Seeding ${TOTAL_ROWS.toLocaleString()} rows in batches of ${BATCH_SIZE}...`);
  const start = Date.now();

  for (let offset = 0; offset < TOTAL_ROWS; offset += BATCH_SIZE) {
    const batchSize = Math.min(BATCH_SIZE, TOTAL_ROWS - offset);
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (let i = 0; i < batchSize; i++) {
      const service = randomElement(SERVICES);
      const level = randomElement(LEVELS);
      placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4})`);
      values.push(
        randomTimestamp().toISOString(),
        level,
        service,
        randomElement(MESSAGES_BY_LEVEL[level]!),
        JSON.stringify(randomAttributes(service))
      );
      idx += 5;
    }

    await pool.query(
      `INSERT INTO logs (timestamp, level, service, message, attributes) VALUES ${placeholders.join(", ")}`,
      values
    );

    const done = offset + batchSize;
    if (done % 50_000 === 0 || done === TOTAL_ROWS) {
      const pct = ((done / TOTAL_ROWS) * 100).toFixed(1);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  ${done.toLocaleString()} / ${TOTAL_ROWS.toLocaleString()} rows (${pct}%) -- ${elapsed}s elapsed`);
    }
  }

  const total = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone! Inserted ${TOTAL_ROWS.toLocaleString()} rows in ${total}s`);
  console.log(`   Avg insert rate: ${(TOTAL_ROWS / parseFloat(total)).toFixed(0)} rows/sec`);
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
