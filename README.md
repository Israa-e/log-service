<div align="center">

# 📊 Log Service

**A high-performance log ingestion and query service**, inspired by Datadog and Grafana Loki.
Ingests structured logs at scale, stores them in TimescaleDB, and provides a rich dashboard for search, aggregation, and retention management.

[![CI](https://github.com/Israa-e/log-service/actions/workflows/ci.yml/badge.svg)](https://github.com/Israa-e/log-service/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![TimescaleDB](https://img.shields.io/badge/TimescaleDB-PG16-fdb515?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Throughput](https://img.shields.io/badge/sustained_throughput-13.8k--15.6k_logs%2Fsec-brightgreen)

</div>

## Contents

- 🧰 [Tech Stack](#tech-stack)
- 🚀 [Quick Start](#quick-start)
- 🖥️ [Dashboard Screens](#dashboard-screens)
- 🔌 [API Contract](#api-contract)
- 🗄️ [Schema](#schema)
- 🔍 [Indexing](#indexing)
- ⚡ [Performance](#performance)
- ✨ [Optional Features](#optional-features)
- 🧹 [Retention](#retention)
- 🧪 [Load Test](#load-test)
- ⚠️ [Known Limitations](#known-limitations)

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

<table>
<tr>
<td width="50%" valign="top">

**Logs Explorer**
Advanced search, filtering by service/level/message, time range selection, and a detail drawer for individual log entries.

![Logs](screens/logs.png)

</td>
<td width="50%" valign="top">

**Analytics & Metrics**
Interactive ECharts visualizations — throughput over time, severity distribution, error clustering, and storage breakdown by service.

![Analytics](screens/Metrics.png)

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Retention Management**
View total events, retention period, active services, and last retention run. Trigger manual cleanup or configure the auto-schedule.

![Retention](screens/retention.png)

</td>
<td width="50%" valign="top">

**Add Logs**
Manual log ingestion interface — submit log entries with timestamp, level, service, message, and optional attributes.

![Add Logs](screens/addLogs.png)

</td>
</tr>
<tr>
<td colspan="2" valign="top">

**AI Support Chat**
Real-time AI-powered support assistant for cluster configuration, queries, and retention policies.

<p align="center"><img src="screens/AiSupport.png" width="50%" /></p>

</td>
</tr>
</table>

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
| `idx_logs_timestamp_id_desc (timestamp DESC, id DESC)` | Default sort + cursor pagination (`(timestamp, id) < (cursor)`); also what `level`-filtered queries fall back to now that `idx_logs_level` is gone |
| `logs_pkey (id, timestamp)` | Primary key |

Exactly one non-pkey index per query dimension — everything else was measured, found not worth its write cost, and dropped:

- Two **GIN indexes** (`attributes` containment, `message` trigram) cost **664 MB — more than the 352 MB of row data itself** on the 1M-row test set, charged synchronously on every insert.
- **`idx_logs_level`** was small, but `level` has only 4 distinct values — concurrent inserts funneled into the same few btree pages, taking a 500-row insert from 9ms to 21.5ms and capping ingest at ~5-8k logs/sec.

Dropping all three roughly **doubled** sustained ingest throughput. `idx_logs_service` was also widened from 2 to 3 columns (adding `id`) so `service=X` queries resolve `ORDER BY timestamp DESC, id DESC` as a single index scan instead of an extra sort — measured ~30% faster per 1000-row page, which matters because the read-after-write check pages through exactly this shape.

**Trade-off:** `attr.<key>` and `q=` filters are unindexed, relying on `since`/`until` chunk exclusion when present. A query combining them with no time range does a full scan — an accepted cost, since sustained ingest throughput mattered far more here.

## Performance

**Test setup:** Docker, containers capped to the grading limits (app: 0.5 CPU/256MB, db: 1 CPU/1GB), measured against a warm ~2M-row dataset with a concurrent-batch load generator.

**Starting bottleneck:** the db container was pegged at 100%+ of its single core while the app sat at ~10% — Postgres, not the app, was the constraint. Three compounding causes: two GIN indexes charged on every insert, `express-session` running on every request (including hot paths that don't use it), and `/logs/aggregate` scanning every raw row in range on every call.

**Before → after** (same dataset/limits/generator):

| Metric | Before | After |
|---|---|---|
| Sustained ingest throughput | ~2,995 logs/sec | ~8,700–17,000 logs/sec (local; varies by run length) |
| `/logs/aggregate` latency, idle | ~0.75s | ~0.03–0.04s |
| db container CPU | pegged ~100–107% | no longer pegged |

Local numbers are directional only — the **graded run is authoritative**, and achieved **13,780–15,625 logs/sec sustained** across all four load scenarios (Load/Stress/Spike/Breakpoint), both containers under 30% CPU on average.

**What moved the needle, in order:**
1. Dropped both GIN indexes plus a redundant duplicate `timestamp` index — **~2x throughput** alone.
2. Scoped `express-session` off the ingest/query hot path — **+~20%**.
3. Split the connection pool: a dedicated pool for `POST /logs` vs. one for `GET /logs`/`GET /logs/aggregate`, so a slow read can no longer queue behind a burst of concurrent inserts holding every connection.
4. Relaxed commit durability (`synchronous_commit=off`, tuned `shared_buffers`/`max_wal_size`/checkpoint target) — an acceptable trade-off since losing a few hundred ms of unflushed logs on a hard crash is tolerable here.

**Rollup design — two rejected attempts before this one:**
- *TimescaleDB continuous aggregate* (refreshed every 10s): looked great idle, but under sustained load the refresh — competing with inserts for the same core — fell up to **2 minutes behind**, a real eventual-consistency failure past the 20s contract.
- *Synchronous upsert per insert*: always consistent, but concurrent batches serialize on the same "current minute" row lock. Throughput collapsed from ~17k to **~120 logs/sec**.
- **What's running:** an append-only delta table (no unique constraint, no `UPDATE`) — concurrent inserts never block each other, and `SUM(count)` at query time is correct regardless of row count. Deltas are grouped in memory during the request (free) and flushed once a second, decoupling the DB write from the request path entirely. Verified: rollup sum matches the raw count exactly within 1-2 seconds of a sustained run ending.

**Backpressure:** pushed past this hardware's ~15-17k logs/sec ceiling (Stress/Breakpoint ramp to 22.5k-45k/s), the read-after-write consistency check started failing — not data loss, just late visibility once Postgres's connection queue backs up faster than it can drain. `insertLogs` now tracks an EWMA of its own insert latency and sheds new batches with `503`/`Retry-After` once it crosses `MAX_INSERT_LATENCY_MS` (10s, half the 20s SLA) instead of adding to an already-backed-up queue — the shedding the spec explicitly sanctions. Gating on measured latency rather than a queue-depth guess keeps the threshold meaningful regardless of hardware. Verified normal load (the grading harness's batch=33/VUs=70 profile) never trips it — only genuine sustained overload does.

**Tried and reverted:** `COPY` + request coalescing on the write path, to amortize per-statement cost across more rows than one ~33-row request. Passed concurrency tests cleanly, but the full scenario suite showed intermittent 60s aggregate stalls; a confounder (a heavily loaded dev machine reproducing the same stalls on the *already-shipped* baseline) made it impossible to confirm whether that was a real bug or host contention. Reverted rather than ship something un-diagnosed — `INSERT ... unnest` is what's running.

**Named prepared statements** for the two constant-shape hot queries (raw insert, rollup flush) — Postgres parses/plans each once per connection instead of once per call. Verified under 90s of sustained load (30 workers, ~9,500 requests, 312k rows) with zero failures and an exact rollup/raw-count match.

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

- **`attr.<key>`/`q=` aggregate queries fall back to a raw row scan** — the rollup only tracks `count() by minute, service, level`, so it can't filter on an attribute value or message substring. Still correct, just unindexed and bounded by `since`/`until`. The sub-second latency guarantee applies to the filter-less/service-or-level-only path.
- **Aggregate results can lag ingestion by up to ~1 second** — the width of the in-memory accumulator's flush interval. Well inside the 20s visibility SLA; `GET /logs` (reading the raw table directly) always sees new data immediately. A hard crash between flushes loses at most that same ~1 second of rollup deltas — the raw `logs` table is never affected.
- **`attr.<key>`/`q=` filters on `GET /logs` with no `since`/`until` scan the full table** — no index can accelerate a dynamic JSONB key match or substring `ILIKE`, and the GIN indexes that could were deliberately dropped (see Indexing) for their write-time cost. Bounded in practice by pairing these filters with a time range.
- **Retention granularity for `logs` is ~1 chunk interval (default 7 days)**, not exact-to-the-day — `drop_chunks` only removes chunks entirely past the cutoff. `logs_rollup_1m` has no such limit (a plain `DELETE`, exact to the cutoff).
- **No compiled build step** — runs directly via `tsx` rather than a `tsc`-compiled `dist/`. Simpler for this project's scope, small runtime overhead trade-off.
- **No rate limiting/quota system** on `POST /logs` — no per-tenant/per-key throttling. Latency-based backpressure (see Performance) sheds batches with `503`/`Retry-After` once the insert path falls behind the visibility SLA, so overload degrades as controlled 503s rather than an unbounded queue.
- **The rollup accumulator is single-process, in-memory state** — fine under this project's single-container setup, but wouldn't survive multiple app replicas without an external accumulator (e.g. Redis) or a single dedicated writer.

`BATCH_SIZE`, `CONNECTIONS`, and `DURATION` are configurable via env vars; the script reports both requests/sec and the derived logs/sec (`requests/sec * BATCH_SIZE`).
