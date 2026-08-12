# Log Service

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
docker compose up 
```

The service also works in detached mode if preferred:

```bash
docker compose up -d --build
```

- API → `http://localhost:8080`
- Swagger UI → `http://localhost:8080/api-docs`
- Swagger JSON → `http://localhost:8080/api-docs.json`
- Dashboard → `http://localhost:8080/` (default login: `admin` / `admin123`)

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

![Add Logs](screens/addLogs.png)

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
| `page` | 1-based page number (offset pagination) |
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
{ "username": "admin", "password": "admin123" }
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

Converted to a TimescaleDB hypertable partitioned by `timestamp`. `attributes` values are normalized to strings at write time (`{user_id: 42}` → `{user_id: "42"}`), matching the API contract's "compared as strings" semantics for `attr.<key>` filters, and queried with the JSONB `@>` containment operator.

A second object, `logs_rollup_1m`, is a TimescaleDB **continuous aggregate** — a materialized, incrementally-refreshed rollup of `count(*) GROUP BY minute, service, level`. `GET /logs/aggregate` reads from it instead of scanning raw rows whenever the request has no `attr.*`/`q` filter (the two dimensions the rollup doesn't track), which is the common case and the one the performance target is about. See Performance below for why this exists.

## Indexing

| Index | Purpose |
|---|---|
| `idx_logs_service (service, timestamp DESC)` | Service filters |
| `idx_logs_level (level, timestamp DESC)` | Level filters |
| `idx_logs_timestamp_id_desc (timestamp DESC, id DESC)` | Default sort + cursor pagination (`(timestamp, id) < (cursor)`) |
| `logs_pkey (id, timestamp)` | Primary key |

That's deliberately the whole list — every index here is a plain btree, and there's exactly one non-pkey index per query dimension. Two write-heavy indexes were removed after measurement (see Performance): a GIN `jsonb_path_ops` index on `attributes`, and a GIN trigram index on `message` for `q=` search. On this project's 1 M-row test dataset those two indexes alone accounted for **664 MB — more than the 352 MB of actual row data** — and GIN maintenance is charged synchronously on every insert. With Postgres capped at 1 CPU and a 15k+ logs/sec target, that write cost was the dominant bottleneck: dropping them roughly doubled sustained ingest throughput on its own.

The trade-off: `attr.<key>` and `q=` (message `ILIKE`) filters are now unindexed. They're evaluated as a filter over whatever range `since`/`until` bounds via TimescaleDB chunk exclusion — fine for the correctness checks and for filtered browsing in the dashboard, but a query combining `attr.*`/`q` with no time range (or a very wide one) does a full scan. Given the resource envelope, that's the right place to spend (or rather, not spend) CPU: sustained ingest throughput is worth far more than making a rarely-hit filter combination fast.

## Performance

**Test environment:** Docker, containers capped to match the spec's grading limits — app: `cpus: 0.5`, `mem_limit: 256m`; db: `cpus: 1`, `mem_limit: 1g`. Measured against a warm ~2M-row dataset using a small concurrent-batch load generator (`Content-Type: application/json`, batches of 500 logs, 20–25 concurrent connections against `POST /logs`), `docker stats` sampled every second for resource usage, and `curl -w '%{time_total}'` against `/logs/aggregate` sampled throughout the run for latency.

**What was actually happening before this pass, and why:** app CPU usage during ingestion was ~10% of its 0.5-CPU budget while the db container was pegged at 100%+ of its single core — Postgres, not the app, was the bottleneck the whole time. Two problems were compounding it:

1. **Over-indexing on the write path** — the two GIN indexes described above (attributes containment + message trigram) were charged in full on every insert, on a single CPU already the limiting resource.
2. `express-session` middleware ran globally on *every* request, including `POST /logs`, `GET /logs`, and `GET /logs/aggregate` — none of which use a session. It's now scoped only to the dashboard/`/auth` routes that actually need it.
3. `GET /logs/aggregate` computed its counts by scanning every raw row in the queried range on every request. During sustained high-rate ingestion, even a 10-minute window contains hundreds of thousands of rows, so aggregate latency scaled directly with ingestion rate — no index fixes that, because the cost is in aggregating rows, not finding them.

**Measured before → after** (same dataset, same container limits, same load generator):

| Metric | Before | After |
|---|---|---|
| Sustained ingest throughput | ~2,995 logs/sec | **~16,984 logs/sec** (exceeds the 15,000/sec target) |
| `/logs/aggregate` latency, idle | ~0.75s (already near the 1s budget) | **~0.03–0.04s** |
| `/logs/aggregate` latency, under concurrent ingest load | 4–5.5s (p95 far past target) | **mostly <1s**, one cold-start outlier around 2s at the very start of a run |
| db container CPU | pegged ~100–107% throughout | ~65% avg / ~100% peak — no longer pegged constantly |
| app container CPU | ~10% avg (nowhere near its cap — irrelevant, since db was the bottleneck) | ~41% avg / ~50% peak (now using its budget productively) |

**Optimizations applied, in the order they mattered:**
1. Dropped the two GIN indexes (attributes containment, message trigram) and a redundant duplicate btree index on `timestamp` that TimescaleDB creates by default and that the newer `(timestamp DESC, id DESC)` index already subsumes. **~2x ingest throughput** on its own.
2. Scoped `express-session` off the ingest/query hot path. **+~20% ingest throughput.**
3. Added `logs_rollup_1m`, a TimescaleDB continuous aggregate at 1-minute/service/level granularity, and pointed the unfiltered-by-`attr`/`q` aggregate path at it instead of the raw table. Took aggregate latency from multiple seconds to sub-second, and — because it's a separate table the write path never touches — stopped it from contending with concurrent inserts for the same CPU.
4. Set `materialized_only = true` on the continuous aggregate (disables TimescaleDB's default "real-time aggregation," which would otherwise union the rollup with a live scan of not-yet-refreshed raw rows on every query). That live-scan branch was itself contending with concurrent inserts on the same active chunk and causing multi-second spikes. With a 10-second refresh policy, this bounds staleness to ~10–20s, inside the API contract's 20-second visibility window — see Known Limitations.
5. Split the single connection pool into two: a 10-connection pool for `POST /logs`, and a separate 4-connection pool for `GET /logs`/`GET /logs/aggregate`. Before this, a query request queued behind whatever batch of concurrent inserts already held every pooled connection, even though the query itself takes well under a millisecond once it gets a connection. On a CPU-constrained single-core db, growing one shared pool made things *worse* (more concurrent backends contending for the same core, tested and reverted) — the fix was giving reads their own lane, not more total connections.
6. `synchronous_commit=off`, `shared_buffers=256MB`, `max_wal_size=2GB`, `checkpoint_completion_target=0.9` on the db container — reduces per-commit fsync wait; an acceptable trade-off for a workload where losing a few hundred milliseconds of unflushed logs on a hard crash is tolerable.

**Remaining bottleneck:** ingestion is now roughly evenly split between app CPU (~50% of its 0.5-core cap) and db CPU (~65% avg, spiking to 100%) — both containers are being used close to their limits rather than one idling while the other saturates. Pushing meaningfully past ~17k logs/sec on this hardware would need either a cheaper per-row validation path on the app side, or moving some of that CPU cost (e.g. batch validation) off the request path entirely.

## Optional Features

`docker compose up` with no `.env` file or manual setup serves the plain core service: `GET /health`, `POST /logs`, `GET /logs`, and `GET /logs/aggregate` are all unauthenticated, unthrottled, and behave exactly per the required API contract. Everything below is additive on top of that and does not gate, rename, or change the shape of any required endpoint.

| Feature | Default | Env var(s) | Notes |
|---|---|---|---|
| Dashboard (`/logs-explorer`, `/analytics`, `/ingestion`, `/retention`, `/users`) | Enabled, multi-user login | `ADMIN_USERNAME` (default `admin`), `ADMIN_PASSWORD` (default `admin123`), `SESSION_SECRET` | Session-cookie login for the *HTML pages only* — `/health`, `/logs`, and `/logs/aggregate` are never behind this check. A single admin account is seeded idempotently on first startup from `ADMIN_USERNAME`/`ADMIN_PASSWORD`; once logged in, use the Users page (or `POST /auth/users`) to create further dashboard accounts — passwords are hashed with `crypto.scrypt`, never stored in plaintext. No `AUTH_ENABLED`/API-key contract is implemented, so the required endpoints always run unauthenticated. Copy `.env.example` to `.env` to override the seeded credentials and session secret; without one, the defaults above apply. |
| Alerts (`POST /alerts`) | Enabled, no-op until configured | — | Fires a webhook when an error-count threshold is crossed; does nothing until a rule is created. Does not affect ingestion or query paths. |
| Notifications (`/notifications`) | Enabled | — | In-app notification feed (e.g. retention run summaries). Read-only side effect, no impact on required endpoints. |
| AI support chat (`/support`) | Disabled without a key | `OPENAI_API_KEY` (unset by default) | Purely additive UI feature; unset key just disables the chat, everything else still runs. |

None of these introduce a required parameter, header, or credential on `/health`, `POST /logs`, `GET /logs`, or `GET /logs/aggregate`.

## Retention

A background job runs hourly (and once on startup) calling `SELECT drop_chunks('logs', older_than => cutoff)`, where `cutoff = now() - RETENTION_DAYS` (default 30). Since `logs` is a TimescaleDB hypertable, this drops entire expired chunks instead of deleting rows one at a time — no per-row WAL/vacuum churn, no long-running locks, and no ingestion disruption. The trade-off: a chunk is only dropped once it's *entirely* older than the cutoff, so actual retention enforcement has a granularity of one `chunk_time_interval` (default 7 days) — data can live up to ~7 days past `RETENTION_DAYS` before its chunk is dropped. `POST /logs/retention/run` triggers the same logic on demand from the dashboard.

The same run also calls `drop_chunks('logs_rollup_1m', older_than => cutoff)`. The continuous aggregate's materialized data lives in its own hypertable, so dropping chunks from `logs` doesn't touch it — without this, the rollup would grow forever regardless of `RETENTION_DAYS`.

## Load Test

```bash
docker compose up --build -d
BATCH_SIZE=500 CONNECTIONS=8 DURATION=20 node load-test.js
```

## Known Limitations

- **`attr.<key>`/`q=` aggregate queries fall back to a raw row scan.** The continuous aggregate only tracks `count() by minute, service, level` — it has no way to filter on an attribute value or message substring. `GET /logs/aggregate?attr.user_id=42...` still works and returns correct results, just via the same unindexed scan `GET /logs` uses, bounded by `since`/`until`. The sub-second latency guarantee applies to the filter-less/service-or-level-only aggregate path, which is the one under explicit performance target.
- **Aggregate results can lag ingestion by up to ~10–20 seconds.** The rollup refreshes on a 10-second schedule and real-time aggregation is disabled (see Performance #4) to avoid contending with concurrent inserts. This is inside the API contract's 20-second visibility window, but it means a log ingested moments ago may not yet be reflected in an aggregate count, even though `GET /logs` (which reads the raw table directly) sees it immediately.
- **`attr.<key>`/`q=` filters on `GET /logs` with no `since`/`until`** scan the full table — there's no index that can accelerate an equality match on a dynamic JSONB key or a substring `ILIKE` while preserving the spec's "compared as strings" semantics, and GIN indexes for both were deliberately removed (see Indexing) because their write-time cost was the dominant ingestion bottleneck. In practice this is bounded by pairing these filters with a time range, which the dashboard and the required query pattern both do.
- **Retention granularity is ~1 chunk interval (default 7 days)**, not exact-to-the-day, because `drop_chunks` only removes chunks entirely past the cutoff. This applies to both `logs` and `logs_rollup_1m`.
- **No compiled build step** — the app runs directly via `tsx` in the container rather than a `tsc`-compiled `dist/`. Simpler for this project's scope, but adds a small amount of startup/runtime overhead compared to precompiled JS.
- **No rate limiting or backpressure** on `POST /logs` — a client can push more concurrent batches than the containers can absorb, at which point requests queue behind the connection pool rather than being rejected or throttled.
- **First migration on a dataset with pre-existing historical data does a one-time full backfill** of the continuous aggregate (`CALL refresh_continuous_aggregate('logs_rollup_1m', NULL, NULL)`), guarded to run only once (when the rollup is empty). On ~2M pre-existing rows this added a few seconds to startup before `/health` reported ready; on a fresh empty database (the normal case) it's a no-op.

`BATCH_SIZE`, `CONNECTIONS`, and `DURATION` are configurable via env vars; the script reports both requests/sec and the derived logs/sec (`requests/sec * BATCH_SIZE`).
