# Obsidian Log Engine

A high-performance log ingestion and query service, inspired by Datadog and Grafana Loki. Ingests structured logs at scale, stores them in TimescaleDB, and provides a rich dashboard for search, aggregation, and retention management.


## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (Node.js) |
| Framework | Express |
| Database | PostgreSQL 16 + TimescaleDB |
| Frontend | Tailwind CSS, ECharts |
| Infrastructure | Docker Compose, GitHub Actions |

## Quick Start

```bash
docker compose up -d --build
```

- API → `http://localhost:8080`
- Dashboard → `http://localhost:8080/` (password: `LogService2026!`)

## Dashboard Screens

### Logs Explorer
Advanced search, filtering by service/level/message, time range selection, and a detail drawer for individual log entries.
![Logs](screens/logs.png)

### Analytics & Metrics
Interactive ECharts visualizations — throughput over time, severity distribution, error clustering, and storage breakdown by service.

![Analytics](screens/Metrics.png)

### Retention Management
View total events, retention period, active services, and last retention run. Trigger manual cleanup or configure the auto-schedule.

![Retention](screens/retention.png)

### Add Logs 
Manual log ingestion interface — submit log entries with timestamp, level, service, message, and optional attributes.

![Logs Explorer](screens/addLogs.png)

### AI Support Chat
Real-time AI-powered support assistant for cluster configuration, queries, and retention policies.

![AI Support](screens/AiSupport.png)

## API Contract

### `POST /logs` — Ingestion

```json
{
  "logs": [
    {
      "timestamp": "2026-07-20T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": { "user_id": "42", "region": "eu-west" }
    }
  ]
}
```

Invalid entries are reported by index without failing the batch:

```json
{ "accepted": 9, "rejected": [{ "index": 3, "reason": "invalid level: 'critical'" }] }
```

### `GET /logs` — Query

| Param | Description |
|---|---|
| `service` | Exact match |
| `level` | Exact match |
| `since` / `until` | ISO 8601 time range |
| `attr.<key>` | Attribute equality |
| `q` | Case-insensitive message search |
| `limit` | Max results (default 100, max 1000) |
| `cursor` | Opaque pagination cursor |

### `GET /logs/aggregate` — Aggregation

Required: `since`, `until`, `bucket` (`1m`, `5m`, `1h`, `1d`). Optional: `service`, `level`, `q`, `group_by`.

```json
{ "buckets": [{ "start": "2026-07-20T14:00:00Z", "group": "checkout", "count": 118 }] }
```

### `POST /logs/retention/run`

Manually trigger retention cleanup (deletes logs older than `RETENTION_DAYS` env var, default 30).

### `POST /auth/login`

```json
{ "password": "LogService2026!" }
```

Returns a session cookie.

### `POST /alerts`

Create an alert rule — fires a webhook when error count exceeds a threshold within a time window.

## Schema

```sql
CREATE TABLE logs (
  id SERIAL,
  timestamp TIMESTAMPTZ NOT NULL,
  level TEXT NOT NULL,
  service TEXT NOT NULL,
  message TEXT NOT NULL,
  attributes JSONB,
  PRIMARY KEY (id, timestamp)
);
SELECT create_hypertable('logs', 'timestamp');
```

Converted to a TimescaleDB hypertable partitioned by `timestamp`. Attribute filters use `attributes ->> 'key' = 'value'` for type-safe comparison across mixed JSON types.

## Indexing

| Index | Purpose |
|---|---|
| `idx_logs_service (service, timestamp DESC)` | Service filters |
| `idx_logs_level (level, timestamp DESC)` | Level filters |
| `idx_logs_message_trgm` (GIN trigram) | Substring message search |

## Performance

Tested with ~1M rows and 20 concurrent connections:

| Metric | Result | Target |
|---|---|---|
| Ingestion throughput | **1,408 req/s** | 500/sec |
| Latency (p95) | **47ms** | — |
| Aggregation (p95) | **72ms** | <1000ms |

## Retention

Runs on startup and every hour, deleting logs older than `RETENTION_DAYS` (default: 30). Deletion is batched (1,000 rows at a time) to avoid locking.

## Load Test

```bash
npx tsx scripts/seed.ts          # Seed 1M rows
npx autocannon -c 20 -d 10 ...   # Run benchmark
```
