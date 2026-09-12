import autocannon from "autocannon";

// Load-test configuration.
// These values can be overridden with environment variables.
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "200", 10);
const DURATION = parseInt(process.env.DURATION || "20", 10);
const CONNECTIONS = parseInt(process.env.CONNECTIONS || "20", 10);

const URL = process.env.URL || "http://localhost:8080/logs";

/**
 * Creates one batch of structured logs.
 *
 * One HTTP request contains BATCH_SIZE logs.
 */
function makeBatch() {
  const logs = [];
  const now = Date.now();

  for (let i = 0; i < BATCH_SIZE; i++) {
    logs.push({
      timestamp: new Date(now).toISOString(),
      level: ["debug", "info", "warn", "error"][i % 4],
      service: ["checkout", "auth", "inventory", "billing"][i % 4],
      message: `load test log entry ${i}`,
      attributes: {
        user_id: String(1000 + i),
        region: "eu-west",
        retries: i % 5,
      },
    });
  }

  return JSON.stringify({ logs });
}

const body = makeBatch();

console.log("=== Log Service Load Test ===");
console.log(`URL: ${URL}`);
console.log(`Batch size: ${BATCH_SIZE} logs/request`);
console.log(`Connections: ${CONNECTIONS}`);
console.log(`Duration: ${DURATION}s`);
console.log("");

autocannon({
  url: URL,
  method: "POST",
  duration: DURATION,
  connections: CONNECTIONS,
  headers: {
    "Content-Type": "application/json",
  },
  body,
}).on("done", (result) => {
  const requestsPerSec = result.requests.average;
  const logsPerSec = requestsPerSec * BATCH_SIZE;

  console.log("=== Ingestion Result ===");

  console.log(`Requests/sec: ${requestsPerSec.toFixed(2)}`);

  console.log(
    `Logs/sec: ${logsPerSec.toFixed(0)} ` +
      `(${requestsPerSec.toFixed(2)} requests/sec × ${BATCH_SIZE} logs/request)`
  );

  // Autocannon exposes p97.5 as p97_5.
  // We label it honestly instead of calling it p95.
  console.log(`Latency p97.5: ${result.latency.p97_5} ms`);

  console.log(`Non-2xx responses: ${result.non2xx}`);
  console.log(`Timeouts: ${result.timeouts}`);

  console.log("");

  if (result.non2xx === 0 && result.timeouts === 0) {
    console.log("Result: All requests completed without non-2xx responses or timeouts.");
  } else {
    console.log("Result: Some requests failed or timed out. Investigate before reporting throughput.");
  }

  console.log("");
  console.log("=== Target ===");
  console.log("Target ingestion rate: 15,000 logs/sec");

  if (logsPerSec >= 15_000 && result.non2xx === 0 && result.timeouts === 0) {
    console.log("Target status: ACHIEVED");
  } else {
    console.log("Target status: NOT ACHIEVED");
  }
});

