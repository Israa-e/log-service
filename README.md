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

A second table, `logs_rollup_1m (bucket_start, service, level, count)`, is a pre-aggregated rollup: `count(*) by minute, service, level`, append-only (no unique constraint — see Performance for why). `GET /logs/aggregate` reads from it instead of scanning raw rows whenever the request has no `attr.*`/`q` filter (the two dimensions the rollup doesn't track), which is the common case and the one the performance target is about. It's maintained by the app process itself — see Performance — not by a database background job.

## Indexing

| Index | Purpose |
|---|---|
| `idx_logs_service_ts_id (service, timestamp DESC, id DESC)` | Service filters + cursor pagination (`(timestamp, id) < (cursor)`) with no extra sort |
| `idx_logs_level (level, timestamp DESC)` | Level filters |
| `idx_logs_timestamp_id_desc (timestamp DESC, id DESC)` | Default sort + cursor pagination (`(timestamp, id) < (cursor)`) |
| `logs_pkey (id, timestamp)` | Primary key |

That's deliberately the whole list — every index here is a plain btree, and there's exactly one non-pkey index per query dimension. Two write-heavy indexes were removed after measurement (see Performance): a GIN `jsonb_path_ops` index on `attributes`, and a GIN trigram index on `message` for `q=` search. On this project's 1 M-row test dataset those two indexes alone accounted for **664 MB — more than the 352 MB of actual row data** — and GIN maintenance is charged synchronously on every insert. With Postgres capped at 1 CPU and a 15k+ logs/sec target, that write cost was the dominant bottleneck: dropping them roughly doubled sustained ingest throughput on its own.

`idx_logs_service` (2-column) was replaced with the 3-column version above: with only `(service, timestamp DESC)`, a `service=X` query still needs an extra Incremental Sort to break ties on `id` for rows sharing a timestamp, since `id` isn't in the index. Measured ~30% slower per 1000-row page than the 3-column index, which resolves the whole ORDER BY (and the cursor's `(timestamp, id) < (...)` tie-break) as a single index scan. This matters specifically for `GET /logs?service=X&...`, cursor-paginated at up to 1000 rows/page — the load generator's read-after-write check pages through exactly this shape, once per service, inside a fixed time budget, so per-page latency directly bounds how much of the accepted data it can see in time.

The trade-off: `attr.<key>` and `q=` (message `ILIKE`) filters are now unindexed. They're evaluated as a filter over whatever range `since`/`until` bounds via TimescaleDB chunk exclusion — fine for the correctness checks and for filtered browsing in the dashboard, but a query combining `attr.*`/`q` with no time range (or a very wide one) does a full scan. Given the resource envelope, that's the right place to spend (or rather, not spend) CPU: sustained ingest throughput is worth far more than making a rarely-hit filter combination fast.

## Performance

**Test environment:** Docker, containers capped to match the spec's grading limits — app: `cpus: 0.5`, `mem_limit: 256m`; db: `cpus: 1`, `mem_limit: 1g`. Measured against a warm ~2M-row dataset using a small concurrent-batch load generator (`Content-Type: application/json`, batches of 500 logs, 20–25 concurrent connections against `POST /logs`), `docker stats` sampled every second for resource usage, and `curl -w '%{time_total}'` against `/logs/aggregate` sampled throughout the run for latency.

**What was actually happening before this pass, and why:** app CPU usage during ingestion was ~10% of its 0.5-CPU budget while the db container was pegged at 100%+ of its single core — Postgres, not the app, was the bottleneck the whole time. Two problems were compounding it:

1. **Over-indexing on the write path** — the two GIN indexes described above (attributes containment + message trigram) were charged in full on every insert, on a single CPU already the limiting resource.
2. `express-session` middleware ran globally on *every* request, including `POST /logs`, `GET /logs`, and `GET /logs/aggregate` — none of which use a session. It's now scoped only to the dashboard/`/auth` routes that actually need it.
3. `GET /logs/aggregate` computed its counts by scanning every raw row in the queried range on every request. During sustained high-rate ingestion, even a 10-minute window contains hundreds of thousands of rows, so aggregate latency scaled directly with ingestion rate — no index fixes that, because the cost is in aggregating rows, not finding them.

**Measured locally, before → after the index/session fixes** (same dataset, same container limits, same load generator):

| Metric | Before | After |
|---|---|---|
| Sustained ingest throughput | ~2,995 logs/sec | ~8,700–17,000 logs/sec (varies with run length; see caveat below) |
| `/logs/aggregate` latency, idle | ~0.75s (already near the 1s budget) | ~0.03–0.04s |
| db container CPU | pegged ~100–107% throughout | no longer pegged constantly |
| app container CPU | ~10% avg (irrelevant — db was the bottleneck) | using its budget productively instead of idling |

**Caveat on absolute numbers:** local short (~15-25s) runs consistently measured faster than local sustained (~90s) runs on this dev machine, and the load-generator submission portal's own measurements are the authoritative numbers, not these local ones — treat the table above as directional (confirming *which* change helped and by roughly how much), not as a promise of a specific logs/sec figure on the actual grading infrastructure. The submitted-and-graded run achieved **13,780–15,625 logs/sec sustained** across all four load scenarios (Load/Stress/Spike/Breakpoint) with both containers well under 30% CPU on average — i.e., meaningful headroom left on this container budget.

**Optimizations applied, in the order they mattered:**
1. Dropped the two GIN indexes (attributes containment, message trigram) and a redundant duplicate btree index on `timestamp` that TimescaleDB creates by default and that the newer `(timestamp DESC, id DESC)` index already subsumes. **~2x ingest throughput** on its own.
2. Scoped `express-session` off the ingest/query hot path. **+~20% ingest throughput.**
3. Split the single connection pool into two: a 10-connection pool for `POST /logs`, and a separate 4-connection pool for `GET /logs`/`GET /logs/aggregate`. Before this, a query request queued behind whatever batch of concurrent inserts already held every pooled connection, even though the query itself takes well under a millisecond once it gets a connection. On a CPU-constrained single-core db, growing one shared pool made things *worse* (more concurrent backends contending for the same core, tested and reverted) — the fix was giving reads their own lane, not more total connections.
4. `synchronous_commit=off`, `shared_buffers=256MB`, `max_wal_size=2GB`, `checkpoint_completion_target=0.9` on the db container — reduces per-commit fsync wait; an acceptable trade-off for a workload where losing a few hundred milliseconds of unflushed logs on a hard crash is tolerable.

**The rollup went through two designs before landing on the current one — worth documenting since both failure modes are non-obvious:**

- **Attempt 1: TimescaleDB continuous aggregate**, refreshed by a background policy every 10s. Idle and short-burst latency looked great (sub-100ms). But under a *sustained* ~90s load test at realistic throughput, the refresh job — competing with concurrent inserts for the same single CPU — fell up to **~2 minutes behind**, because each refresh cycle has to aggregate however much new data arrived, and a policy that can't finish inside its own schedule interval just falls further behind on every subsequent run. This surfaced as a real eventual-consistency failure under load (recently-ingested data missing from aggregate results well past the contract's 20-second tolerance) — a background job whose cost scales with ingestion volume, sharing a CPU with ingestion, has no guaranteed bound on staleness under load.
- **Attempt 2: a plain table, upserted synchronously** (`INSERT ... ON CONFLICT (bucket_start, service, level) DO UPDATE count = count + delta`) inside the same request as the raw insert — always consistent, but concurrent batches almost always touch the same handful of "current minute" counter rows, and Postgres row locks serialize updates to the same row. Measured: throughput collapsed from ~17k to **~120 logs/sec** under concurrent load, because every batch was queuing for a lock held by whichever batch got there first.
- **What's actually running:** the same plain table, but **append-only** — one delta row per batch per distinct `(minute, service, level)` it touches, with no unique constraint and no `UPDATE`. Concurrent inserts never block each other, and `SUM(count)` at query time is correct no matter how many delta rows exist for a bucket. Row count stays small because it's bounded by `batches × distinct groups per batch`, not raw log volume. The rows are grouped in the request path (cheap: a few Map operations) but **not written there** — they're accumulated in an in-memory `Map` and flushed to the table by a `setInterval` in the same Node process every 1 second. This decouples the DB write from the request path entirely: accumulation is free, and the flush cost is a small, bounded, infrequent write regardless of ingestion rate — with no dependency on a database scheduler that can fall behind. Measured: rollup sum matches accepted count exactly within 1-2 seconds of a sustained ~90s run ending, and A/B testing with the accumulation code path disabled entirely showed no measurable ingest throughput difference — i.e., this design's request-path cost is negligible.

**Remaining bottleneck:** ingestion is now split between app CPU (~50% of its 0.5-core cap) and db CPU (which still spikes to its cap under sustained load) — both containers are being used close to their limits rather than one idling while the other saturates. Pushing meaningfully further on this hardware would need either a cheaper per-row validation path on the app side, or moving more of that CPU cost off the request path entirely.

**Backpressure under sustained overload (Stress/Breakpoint):** a graded run pushing sustained rates well past this hardware's ~15-17k logs/sec ceiling (the Stress/Breakpoint scenarios ramp to 22.5k-45k/s) showed the aggregate/read-after-write consistency check failing hard — up to ~89% of accepted logs weren't visible within the 20s window. This isn't data loss (the raw `logs` table and the rollup accumulator are both correct — verified locally: `SUM(count)` from `logs_rollup_1m` matches `COUNT(*)` from `logs` exactly for the same window). It's queueing theory: once arrivals sustainably exceed the single Postgres core's service rate, `pool`'s connection queue grows without bound for as long as the burst lasts, and a batch stuck behind that queue can land — correctly, just very late — well past the visibility SLA. No amount of tuning removes this on fixed hardware; you either raise the ceiling (not much room left here, see above) or stop accepting work you can't service in time.

`insertLogs` now tracks an EWMA of the raw insert's own latency (queue wait + execution) and, once it exceeds `MAX_INSERT_LATENCY_MS` (10s — half the 20s SLA, leaving headroom for the rollup flush and the query side), sheds new batches with `503` + `Retry-After` instead of adding to an already-backed-up queue. This is the backpressure the spec explicitly sanctions ("shedding load with 429/503 is better than crashing"; shed batches don't count as accepted, so they can't count as missing from the consistency check either). Gating on observed latency rather than a queue-depth/connection-count guess keeps the threshold meaningful regardless of hardware — the same millisecond budget means the same thing whether Postgres can push 2k or 20k logs/sec. Verified locally that normal load (matching the grading harness's batch=33/VUs=70 profile) never trips it — only genuine, sustained overload does. The 10s threshold is a starting point, not a measured optimum — it should be re-tuned against the next graded run's actual staleness/latency numbers.

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

The same run also runs `DELETE FROM logs_rollup_1m WHERE bucket_start < cutoff`. `logs_rollup_1m` is a plain table, not a hypertable — dropping chunks from `logs` doesn't touch it, so without this it would grow forever regardless of `RETENTION_DAYS`. A plain `DELETE` is fine here (no chunk-drop needed) because its row count is bounded by `batches × distinct groups per batch`, not raw log volume — orders of magnitude smaller than `logs`.

## Load Test

```bash
docker compose up --build -d
BATCH_SIZE=500 CONNECTIONS=8 DURATION=20 node load-test.js
```

## Known Limitations

- **`attr.<key>`/`q=` aggregate queries fall back to a raw row scan.** The rollup only tracks `count() by minute, service, level` — it has no way to filter on an attribute value or message substring. `GET /logs/aggregate?attr.user_id=42...` still works and returns correct results, just via the same unindexed scan `GET /logs` uses, bounded by `since`/`until`. The sub-second latency guarantee applies to the filter-less/service-or-level-only aggregate path, which is the one under explicit performance target.
- **Aggregate results can lag ingestion by up to ~1 second** — the width of the in-memory accumulator's flush interval (see Performance). Comfortably inside the API contract's 20-second visibility window, but it means a log ingested moments ago may not be reflected in an aggregate count for up to a second, even though `GET /logs` (which reads the raw table directly) sees it immediately. A crash or forced kill (not a graceful `SIGTERM`) between flushes loses at most that same ~1 second of rollup deltas — the raw `logs` table is unaffected either way, since the rollup is a derived read-path optimization, not the source of truth.
- **`attr.<key>`/`q=` filters on `GET /logs` with no `since`/`until`** scan the full table — there's no index that can accelerate an equality match on a dynamic JSONB key or a substring `ILIKE` while preserving the spec's "compared as strings" semantics, and GIN indexes for both were deliberately removed (see Indexing) because their write-time cost was the dominant ingestion bottleneck. In practice this is bounded by pairing these filters with a time range, which the dashboard and the required query pattern both do.
- **Retention granularity for `logs` is ~1 chunk interval (default 7 days)**, not exact-to-the-day, because `drop_chunks` only removes chunks entirely past the cutoff. `logs_rollup_1m` doesn't have this limitation (it's a plain `DELETE`, exact to the cutoff).
- **No compiled build step** — the app runs directly via `tsx` in the container rather than a `tsc`-compiled `dist/`. Simpler for this project's scope, but adds a small amount of startup/runtime overhead compared to precompiled JS.
- **No rate limiting/quota system** on `POST /logs` — any client can ingest as much as the hardware allows; there's no per-tenant or per-key throttling. There is latency-based overload backpressure (see Performance) that sheds batches with `503`/`Retry-After` once the raw insert path is clearly falling behind the visibility SLA, so a sustained overload degrades as controlled 503s rather than an unbounded queue and silent consistency failure.
- **The rollup accumulator is single-process, in-memory state.** This app only ever runs as one container/process per the required setup, so that's not a concern here, but it's worth naming as a constraint the current design depends on: it would not survive a move to multiple app replicas without an external accumulator (e.g. Redis) or routing all ingestion through one writer.

`BATCH_SIZE`, `CONNECTIONS`, and `DURATION` are configurable via env vars; the script reports both requests/sec and the derived logs/sec (`requests/sec * BATCH_SIZE`).
