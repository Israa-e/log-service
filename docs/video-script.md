# Final Project Demo — Video Script

A timed outline for the required demo video/live walkthrough. Target length ~12-15 min.
Complements the deeper prep in `interview-prep.md`, `hard-questions.md`, `code-explanation.md`,
and `walkthrough/` — this is the *run order*, those are the *answer bank*.

---

## 0. Before you hit record

- [ ] Rotate/confirm the `OPENAI_API_KEY` in `.env` is a fresh, non-committed value (see security note from this session — `.env` was previously tracked in git history).
- [ ] `docker compose down -v` then `docker compose up -d --build` fresh, so the DB is empty and you can show real ingestion from zero.
- [ ] Have `scripts/seed.ts` ready but **don't** run it yet — you'll seed live in section 3 so the "queryable within 20s" claim is visibly true.
- [ ] Two terminals open: one for `docker compose`/`curl`/`psql`, one for editing code.
- [ ] `psql` connection ready: `psql -h localhost -p 5433 -U loguser -d logdb` (password `logpass`).

---

## 1. Intro (~1 min)

Say what it is in one breath: *"Obsidian Log Engine — a log ingestion and query service in
TypeScript/Express backed by TimescaleDB, built to the Boot.dev final-project spec: batch
ingest at 15k+ logs/sec, filterable/paginated query, time-bucketed aggregation, retention,
all inside a 0.5 CPU/256MB app container and a 1 CPU/1GB db container."*

```bash
docker compose up -d --build
curl http://localhost:8080/health
```

Expect `200` only once migrations have applied and the DB is ready — show this is a real
readiness check, not a static `200`.

---

## 2. Schema & indexes (~2-3 min)

Open `src/db/schema.sql` and `src/db/indexes.sql` side by side.

**Schema** — three tables: `logs` (the core one), `alert_rules`, `notifications`.
Point at:
- `PRIMARY KEY (id, timestamp)` — composite key is required because `logs` becomes a
  TimescaleDB **hypertable** partitioned on `timestamp` (`src/db/migrate.ts` calls
  `create_hypertable`) — a hypertable's partitioning column must be part of every unique
  constraint.
- `attributes JSONB` — flexible per-log key/value data without a schema migration per field.

**Indexes** — read `indexes.sql` line by line, it's written to be read aloud:
- `idx_logs_service (service, timestamp DESC)` and `idx_logs_level (level, timestamp DESC)` —
  composite so a filtered scan is already in the right sort order for `ORDER BY timestamp DESC`.
- `idx_logs_message_trgm` (GIN trigram) — the only way to accelerate `ILIKE '%q%'` (leading
  wildcard defeats a plain B-tree).
- **The interesting one:** `DROP INDEX IF EXISTS idx_logs_attributes`. Explain this is a
  *deliberate removal*, not an oversight — say it exactly like this:
  > "`attr.<key>` filters use `attributes ->> key = value` — text extraction, because
  > attribute values need to compare correctly whether they were stored as a string, number,
  > or boolean. A GIN index only accelerates the `@>` containment operator, not `->>` — and
  > since the key itself is chosen per-request, there's no fixed key to build an expression
  > index around anyway. So instead of a dead-weight index, we rely on TimescaleDB **chunk
  > exclusion**: every `attr.<key>` query is expected to carry `since`/`until`, and Postgres
  > skips whole chunks outside that range before it ever touches `attributes`."

This is the single most-probed design decision in the rubric (see `hard-questions.md` Q1) —
know it cold, don't read it off the screen.

---

## 3. Live ingestion (~2 min)

```bash
BATCH_SIZE=500 CONNECTIONS=8 DURATION=20 node load-test.js
```

While it runs, in the other terminal:

```bash
watch -n1 "docker stats --no-stream"
```

Narrate what you expect and then point at it happening: db container pinned near 100% of its
1 CPU quota (the bottleneck), app container comfortably under its 0.5 CPU quota. Report the
measured throughput from README (~15,100-17,700 logs/sec at this profile) and confirm the run
matches roughly.

Then prove "new data queryable within 20s":

```bash
curl "http://localhost:8080/logs?limit=1"
```

Show a row with a `timestamp` from seconds ago.

---

## 4. Query + pagination + aggregation (~2 min)

```bash
curl "http://localhost:8080/logs?service=checkout&level=error&limit=5"
curl "http://localhost:8080/logs?service=checkout&limit=5&cursor=<next_cursor from above>"
curl "http://localhost:8080/logs/aggregate?since=2026-08-02T00:00:00Z&until=2026-08-02T23:59:59Z&bucket=1h&group_by=service"
```

Narrate the cursor: it's `base64(timestamp, id)`, decoded into `WHERE (timestamp, id) <
($1, $2)` — keyset pagination, not `OFFSET`, so page N doesn't get slower as N grows.

Walk the code path once, fast, so the grader sees you know where everything lives:
`src/routes/logs.ts` → `src/controllers/logsController.ts` (`getLogs`/`aggregateLogs`, just
error-shape translation) → `src/services/logsService.ts` (`queryLogs` ~line 176,
`queryAggregate` ~line 250) — that's where the actual SQL is built.

---

## 5. EXPLAIN ANALYZE (~3 min) — the part you must not improvise

Run these against the seeded/loaded data (`psql -h localhost -p 5433 -U loguser -d logdb`):

**a) Indexed filter — expect an Index Scan:**
```sql
EXPLAIN ANALYZE
SELECT * FROM logs WHERE service = 'checkout' ORDER BY timestamp DESC LIMIT 25;
```
Point at `Index Scan using idx_logs_service` in the plan output and the actual execution time.

**b) attr.<key> WITH a time range — expect chunk exclusion (fewer chunks touched):**
```sql
EXPLAIN ANALYZE
SELECT * FROM logs
WHERE timestamp >= now() - interval '1 hour' AND attributes ->> 'region' = 'eu-west';
```
Point at the plan only scanning recent chunks, not the whole hypertable — this is the chunk
exclusion claim made concrete.

**c) attr.<key> WITHOUT a time range — expect a full/sequential scan (the known limitation):**
```sql
EXPLAIN ANALYZE
SELECT * FROM logs WHERE attributes ->> 'region' = 'eu-west';
```
Say it plainly: *"this is the documented known limitation — no index can serve a dynamic-key
JSONB text comparison, so an attribute filter with no time bound scans everything. In practice
the API and dashboard always pair `attr.*` with `since`/`until`."*

**d) Aggregation — expect it under 1s even with concurrent load:**
```sql
EXPLAIN ANALYZE
SELECT time_bucket('1 hour', timestamp) AS bucket, service, COUNT(*)
FROM logs
WHERE timestamp >= now() - interval '2 hours'
GROUP BY bucket, service ORDER BY bucket;
```

---

## 6. Live modify/extend (~2 min) — pick ONE, rehearse it once beforehand

**Primary: add a new aggregate bucket size.**
Open `src/services/logsService.ts` around line 261 (`bucketMap`) and add a line live:
```ts
"10m": "10 minutes",
```
Save, the container picks it up via `tsx` (no rebuild needed since there's no compile step —
mention that's also why "no compiled build step" is a listed known limitation, it's a
deliberate simplicity tradeoff). Then immediately prove it:
```bash
curl "http://localhost:8080/logs/aggregate?since=...&until=...&bucket=10m"
```

**Fallback if asked for something else on the spot: add a new log level.**
`VALID_LEVELS` at line 3 of the same file — add `"critical"`, re-run a `POST /logs` with
`"level": "critical"` and show it now gets accepted instead of rejected. Mention the same
constant is checked in two places (line 42 ingestion validation, line 285 aggregate query
validation) — if asked "what else would you need to touch," say exactly that.

---

## 7. Wrap-up: known limitations (~1-2 min)

Read these straight from the README's Known Limitations section, don't paraphrase into
something less precise than what's already written:
- Aggregate p95 can occasionally exceed 1s under heavy concurrent ingestion — CPU contention
  on the db container's single core, not a bad query plan (same query runs <100ms with no
  concurrent writes). Next step if given more time: a continuous aggregate/rollup table.
- `attr.<key>` without a time range is a full scan (demonstrated live in section 5c).
- Retention granularity is ~1 chunk interval (7 days default), not exact-to-the-day.
- No compiled build step (`tsx` directly) — simpler, small runtime overhead tradeoff.
- No rate limiting/backpressure on `POST /logs`.

Close by pointing at CI (`.github/workflows/ci.yml`) building the stack and smoke-testing the
API on every push, and that the repo is public with incremental commit history.

---

## Things that will bite you if you skip rehearsing them

- The chunk-exclusion explanation (section 2) — it's the single most-asked question and easy
  to get backwards under pressure (see `hard-questions.md` Q1 for the fully-worked contrast
  between `@>`/GIN and `->>`/chunk-exclusion).
- Actually running EXPLAIN ANALYZE live requires seeded data with a realistic time spread —
  confirm `scripts/seed.ts` ran successfully *before* recording, not during.
- Don't reference `idx_logs_attributes` as if it still exists — it's dropped, on purpose.
