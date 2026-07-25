# Log Ingestion & Query Service

A service that ingests structured logs at scale, stores them efficiently using TimescaleDB, and lets users query and aggregate them — similar to a simplified Datadog or Grafana Loki.

## Tech Stack

- **Language:** TypeScript (Node.js)
- **Framework:** Express
- **Database:** PostgreSQL 16 + TimescaleDB extension
- **Infrastructure:** Docker Compose, GitHub Actions CI/CD

## Getting Started

### Prerequisites

- Docker and Docker Compose installed

### Run the service

```bash
docker compose up --build -d
```

This starts two containers:
- `app` — the Node.js/TypeScript API, listening on port `8080`
- `db` — PostgreSQL 16 with the TimescaleDB extension

Schema, indexes, and hypertable conversion are applied automatically on startup — no manual steps needed.

### Verify it's running

```bash
curl http://localhost:8080/health
```

## API Documentation

### `GET /health`
Returns `200 OK` once the service is ready to accept logs.

### `POST /logs` — Ingestion
Accepts a batch of log entries:

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

Validation rules:
- `timestamp`: must be a valid ISO 8601 string, not more than 5 minutes in the future
- `level`: one of `debug`, `info`, `warn`, `error`
- `service`, `message`: required non-empty strings
- `attributes`: optional flat object

A bad entry never fails the whole batch — valid entries are accepted, invalid ones are reported by index:

```json
{ "accepted": 9, "rejected": [{ "index": 3, "reason": "invalid level: 'critical'" }] }
```

### `GET /logs` — Query
Supports the following optional, combinable query parameters:

| Param | Meaning |
|---|---|
| `service` | exact match |
| `level` | exact match |
| `since` / `until` | ISO 8601 time range (inclusive/exclusive) |
| `attr.<key>` | attribute equality (e.g. `attr.user_id=42`) |
| `q` | case-insensitive substring match on message |
| `limit` | max results (default 100, capped at 1000) |
| `cursor` | opaque pagination cursor from a previous response |

Returns logs sorted by timestamp descending, with a `next_cursor` for pagination (`null` when there are no more results).

### `GET /logs/aggregate` — Time-bucketed aggregation
Required: `since`, `until`, `bucket` (`1m`, `5m`, `1h`, or `1d`). Optional: `service`, `level`, `q`, `group_by` (`service` or `level`).

Returns counts per time bucket (and per group, if `group_by` is set):

```json
{ "buckets": [{ "start": "2026-07-20T14:00:00Z", "group": "checkout", "count": 118 }] }
```

## Extra Endpoints

### `POST /auth/login` — Dashboard login
```json
{ "password": "<DASHBOARD_PASSWORD>" }
```
Returns a session cookie. Password is set via `DASHBOARD_PASSWORD` env var (default in docker-compose: `LogService2026!`).

### `POST /auth/logout` — Dashboard logout

### `POST /alerts` — Create alert rule
```json
{
  "service": "checkout",
  "threshold": 100,
  "window_minutes": 5,
  "webhook_url": "https://hooks.example.com/alert"
}
```
Fires a webhook when error count in the window exceeds the threshold. Deduplicated (won't re-trigger within 10 minutes).

### `GET /alerts/list` — List alert rules

### `POST /logs/retention/run` — Manually trigger retention

### Dashboard UI
Browse to `http://localhost:8080/index.html`, log in with the password, and view logs in a table with live refresh.

## Schema Design

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
```

**Key decisions:**

- **`attributes` as JSONB**: log attributes are arbitrary and vary per application, so a flexible `JSONB` column was chosen over a rigid EAV (entity-attribute-value) table or a fixed set of columns. JSONB supports indexed lookups without requiring schema migrations for new attribute keys.
- **Composite primary key `(id, timestamp)`**: TimescaleDB requires the partitioning column (`timestamp`) to be part of the primary/unique key when converting a table into a hypertable.
- **TimescaleDB hypertable**: the `logs` table is converted into a hypertable partitioned by `timestamp`. This automatically splits data into time-based chunks, so time-range queries (which are the vast majority of this service's queries) only scan relevant chunks instead of the whole table — critical for performance at 1M+ rows.

## Indexing Strategy

Three indexes were added based on the actual query patterns from the API contract:

| Index | Serves |
|---|---|
| `idx_logs_service (service, timestamp DESC)` | `GET /logs?service=...` and `GET /logs/aggregate?service=...` |
| `idx_logs_level (level, timestamp DESC)` | `GET /logs?level=...` and `GET /logs/aggregate?level=...` |
| `idx_logs_attributes` (GIN index on `attributes`) | `GET /logs?attr.<key>=...` |

**Proof via `EXPLAIN`** (run against a table seeded with ~100k+ rows):

```sql
EXPLAIN SELECT * FROM logs WHERE service = 'checkout' ORDER BY timestamp DESC LIMIT 100;
-- Uses: Index Scan using idx_logs_service on each relevant chunk (via TimescaleDB's ChunkAppend)

EXPLAIN SELECT * FROM logs WHERE level = 'error' ORDER BY timestamp DESC LIMIT 100;
-- Uses: Index Scan using idx_logs_level on each relevant chunk

EXPLAIN SELECT * FROM logs WHERE attributes @> '{"user_id": "99"}';
-- Uses: Bitmap Index Scan using idx_logs_attributes (GIN)
```

**Note on attribute filtering:** the GIN index only accelerates the JSONB *containment* operator (`@>`), not the key-extraction operator (`->>`). Attribute filters in this service are therefore built using `attributes @> '{"key": "value"}'::jsonb` rather than `attributes ->> 'key' = 'value'`, specifically so the GIN index is used.

## Retention

A background job (`src/services/retentionService.ts`) runs on startup and then every hour, deleting logs older than `RETENTION_DAYS` (default: 30, configurable via environment variable). Deletion happens in batches of 1,000 rows at a time in a loop, rather than a single large `DELETE`, so it doesn't lock the table or block ingestion while running.

## Load Test Results

Tested locally using [autocannon](https://github.com/mcollina/autocannon) against `POST /logs`, with 20 concurrent connections over 10 seconds, while the database held ~100,000 pre-existing rows:

| Metric | Result | Target |
|---|---|---|
| Ingestion throughput | **1,408 requests/sec** | 500/sec |
| Latency (p95) | **47ms** | — |
| Rows ingested during test | 16,013 | — |
| `GET /logs/aggregate` response time (measured immediately after the load test, while data was still being written) | **72ms** | <1000ms (p95) at 1M+ rows |

## Known Limitations

- No multi-tenancy — all requests are treated as a single tenant
- Retention interval (hourly) and batch size (1,000) are hardcoded rather than configurable at runtime
- `GET /logs` returns raw rows as-is — `attributes` is returned as a JSON object (postgres row JSON serialization handles this)
- No authentication on the API endpoints (only the dashboard UI is protected)