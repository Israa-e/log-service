import autocannon from "autocannon";

autocannon({
    url: "http://localhost:8080/logs",
    method:"POST",
     duration: 10, // ثواني
  connections: 20, // عدد الاتصالات المتوازية
  headers: {
    "Content-Type": "application/json",
  }, setupClient: (client) => {
    client.on("request", () => {
      client.setBody(
        JSON.stringify({
          logs: [
            {
              timestamp: new Date().toISOString(),
              level: "info",
              service: "load-test",
              message: "autocannon test log",
            },
          ],
        })
      );
    });
  },
}).on("done", (result) => {
  console.log("\n=== النتيجة ===");
  console.log(`Requests/sec: ${result.requests.average}`);
  console.log(`Latency p95: ${result.latency.p97_5} ms`); // أقرب قيمة متوفرة لـ p95
});