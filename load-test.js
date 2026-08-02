import autocannon from "autocannon";

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "200", 10);
const DURATION = parseInt(process.env.DURATION || "20", 10);
const CONNECTIONS = parseInt(process.env.CONNECTIONS || "20", 10);

function makeBatch() {
  const logs = [];
  const now = Date.now();
  for (let i = 0; i < BATCH_SIZE; i++) {
    logs.push({
      timestamp: new Date(now).toISOString(),
      level: ["debug", "info", "warn", "error"][i % 4],
      service: ["checkout", "auth", "inventory", "billing"][i % 4],
      message: `load test log entry ${i}`,
      attributes: { user_id: String(1000 + i), region: "eu-west", retries: i % 5 },
    });
  }
  return JSON.stringify({ logs });
}

const body = makeBatch();

console.log(
  `Ingesting: batch size ${BATCH_SIZE}, ${CONNECTIONS} connections, ${DURATION}s`
);

autocannon({
  url: "http://localhost:8080/logs",
  method: "POST",
  duration: DURATION,
  connections: CONNECTIONS,
  headers: { "Content-Type": "application/json" },
  body,
}).on("done", (result) => {
  const reqPerSec = result.requests.average;
  const logsPerSec = reqPerSec * BATCH_SIZE;
  console.log("\n=== Ingestion result ===");
  console.log(`Requests/sec: ${reqPerSec}`);
  console.log(`Logs/sec (requests/sec * batch size): ${logsPerSec.toFixed(0)}`);
  console.log(`Latency p95: ${result.latency.p97_5} ms (nearest bucket to p95)`);
  console.log(`non-2xx: ${result.non2xx}, timeouts: ${result.timeouts}`);
});
