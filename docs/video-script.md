# Final Project Video — Script & Recording Guide

**Goal:** ~5 minute video: architecture explanation + key decisions + live demo.
**Language:** English narration.
**Estimated words:** ~750 (≈150 wpm).

---

## 0. Preparation Checklist (before you press record)

- [ ] Start the stack: `docker compose up -d --build`
- [ ] Pre-seed 1M rows **before** recording (takes ~60s, don't record it):
      `npx tsx scripts/seed.ts`
- [ ] Verify dashboard works: open `http://localhost:8080` → login `LogService2026!`
- [ ] Open all terminals/pages you need in advance; keep them organized side by side
- [ ] Increase terminal font (Ctrl + '+' in Windows Terminal) so text is readable
- [ ] Close Slack/Teams/email — no notifications during the recording
- [ ] Practice the full script once while reading it from a teleprompter or a second screen

### Windows Tip — enable the mouse-click highlight
Settings → Accessibility → Mouse pointer → "Pointer visibility" on.

---

## 1. Segment 1 — Intro (0:00–0:25)

**Screen:** Title card (project name), then the architecture diagram slide.

**Narration:**
> Hi, this is my final project: Obsidian Log Engine — a high-performance log ingestion and
> query service, inspired by Datadog and Grafana Loki. Applications send structured logs to
> a REST API, and the service stores them, makes them searchable, and aggregates them.
>
> The stack is TypeScript with Express on the front, and PostgreSQL 16 with TimescaleDB as
> the source of truth. The system is designed around three concerns: ingestion, querying,
> and retention — and it's built to sustain 15,000 logs per second while holding over a
> million rows.

---

## 2. Segment 2 — Architecture & Key Decisions (0:25–1:25)

**Screen:** Architecture diagram (Browser → Express → services → Pool → TimescaleDB), then
`src/services/logsService.ts` highlighting the `unnest` INSERT (lines 90–103).

**Narration:**
> The server is layered: routes only map URLs, controllers handle HTTP, and services contain
> the actual SQL. That separation lets me test the logic without the HTTP layer.
>
> The first key decision is the database. Logs are time-series data, so I used TimescaleDB:
> the logs table becomes a hypertable partitioned by timestamp. Chunks are dropped whole at
> retention time, and time-range queries skip entire chunks — that's the foundation of the
> performance.
>
> The second key decision is ingestion. The spec demands fifteen thousand logs per second,
> so we never insert one row at a time. Instead, each HTTP batch becomes one INSERT using
> Postgres `unnest` — one array per column. The query text stays the same size no matter how
> big the batch is, so Postgres doesn't re-parse a growing statement on every request. This
> single change was the biggest throughput win.

---

## 3. Segment 3 — Schema & Index Design (1:25–2:10)

**Screen:** `src/db/schema.sql`, then `src/db/indexes.sql`.

**Narration:**
> The schema has three tables. `logs` has a composite primary key of id and timestamp, which
> TimescaleDB requires. Level, service, and message are plain text; attributes are JSONB.
>
> The attribute storage decision is worth explaining. The spec says attribute filters compare
> as strings, so I filter with `attributes ->> 'key' = 'value'` — text extraction. There is no
> GIN index on attributes, because GIN only accelerates the containment operator, not `->>`,
> and the key is dynamic per request, so a static expression index is impossible. Instead,
> attribute filters are always bounded by the time range, and chunk exclusion keeps the scan
> small.
>
> For the indexes: service and level get composite indexes with timestamp descending, and
> message search uses a trigram GIN index so `ILIKE '%word%'` doesn't do a full scan.
>
> All queries use parameterized statements with numbered placeholders — including dynamic
> attribute keys — so SQL injection isn't possible.

---

## 4. Segment 4 — Live Demo: Core API (2:10–3:35)

**Screen:** Terminal. Run these commands **slowly**, one at a time, narrating as you go.

### 4.1 Health check
```bash
docker compose up -d --build
curl http://localhost:8080/health
```
> The server only starts listening after the database is reachable and migrations have
> applied, so a 200 here means the whole system is ready.

### 4.2 Ingestion with per-entry validation
```bash
curl -s -X POST http://localhost:8080/logs -H "Content-Type: application/json" -d '{
  "logs": [
    {"timestamp": "2026-07-20T14:32:01.123Z", "level": "error",   "service": "checkout", "message": "payment declined", "attributes": {"user_id": "42", "region": "eu-west"}},
    {"timestamp": "2026-07-20T14:32:01.124Z", "level": "fatal",   "service": "checkout", "message": "bad level"},
    {"timestamp": "2026-07-20T14:32:01.125Z", "level": "info",    "service": "auth",     "message": "session created", "attributes": {"user_id": "42"}}
  ]
}'
```
> One entry has an invalid level — fatal isn't allowed. The valid entries are accepted, and
> the invalid one is reported with its index and reason, without failing the batch.

Expected:
```json
{"accepted": 2, "rejected": [{"index": 1, "reason": "invalid level: 'fatal'"}]}
```

### 4.3 Query with filters
```bash
curl -s "http://localhost:8080/logs?service=checkout&level=error&limit=2"
```
> Filters are freely combinable — service, level, time range, attribute equality, and message
> substring search.

### 4.4 Cursor pagination
```bash
curl -s "http://localhost:8080/logs?service=checkout&level=error&limit=2&cursor=<paste next_cursor from previous response>"
```
> Every response includes an opaque next_cursor. Passing it back resumes exactly where the
> last page ended, sorted by timestamp descending with id as the deterministic tiebreaker.
> When there are no more results, next_cursor is null.

### 4.5 Aggregation (the money shot — 1M rows are already seeded)
```bash
curl -s "http://localhost:8080/logs/aggregate?since=2026-07-01T00:00:00Z&until=2026-07-31T23:59:59Z&bucket=5m&group_by=service"
```
> Aggregation uses TimescaleDB's time_bucket: counts per five-minute bucket, optionally
> grouped by service or level, ordered by bucket start. This runs against the seeded million
> rows.

---

## 5. Segment 5 — Live Demo: Retention + Dashboard (3:35–4:15)

### 5.1 Retention
```bash
curl -s -X POST http://localhost:8080/logs/retention/run
```
> Retention is configurable with RETENTION_DAYS — thirty by default. A background job runs
> hourly and calls drop_chunks, which removes entire expired time chunks from disk instead of
> deleting rows one by one. That means no long-running locks and no table bloat.

### 5.2 Dashboard
Open `http://localhost:8080` → log in → click through the tabs quickly.

**Narration:**
> Beyond the API there's a dashboard. The logs explorer combines all the filters with cursor
> pagination, analytics renders the aggregated buckets with ECharts, and the ingestion tab
> lets you send batches manually. There's also alerting — rules that fire a webhook when an
> error threshold is exceeded in a time window — and an AI support chat that answers
> questions using live database context.

---

## 6. Segment 6 — Performance Results (4:15–4:50)

**Screen:** Run the load test (optional, ~20s) and show the README results table side by side.

```bash
BATCH_SIZE=500 CONNECTIONS=8 DURATION=20 node load-test.js
```

**Narration:**
> The load test ran with the exact grading limits: half a CPU and 256 megabytes for the app,
> one CPU and one gigabyte for the database. With batches of five hundred logs, we sustained
> about seventeen thousand logs per second — above the fifteen thousand target. The database
> container runs at ninety-five to one hundred percent CPU during ingestion, which confirms
> the database is the bottleneck, not the application.
>
> The optimizations that got us there: unnest-based batch inserts, removing a redundant count
> query from the cursor path, and Postgres tuning — synchronous commit off, larger shared
> buffers, and a bigger WAL cap.
>
> One honest caveat: under sustained heavy ingestion, the aggregation query occasionally
> exceeds one second at p95 — that's CPU contention on the database's single core, and the
> next step would be pre-computed rollup tables.

---

## 7. Segment 7 — Limitations & Outro (4:50–5:00)

**Screen:** Known Limitations slide.

**Narration:**
> The known limitations are documented honestly in the README: attribute filters without a
> time range do a full scan, retention granularity is one chunk interval, and the app runs via
> tsx rather than a compiled build. Those are trade-offs I made consciously.
>
> The full project — code, CI pipeline, load test methodology, and measured results — is on
> GitHub, and everything starts with a single docker compose up. Thanks for watching.

---

## 8. Recording Guide (OBS)

### OBS Settings
| Setting | Value |
|---|---|
| Base/Output resolution | 1920x1080, 30 fps |
| Recording format | MP4 |
| Encoder | Hardware (NVENC) if available, else x264 "veryfast" |
| Audio | Microphone, 48 kHz, +10 dB gain test first |

### Scene layout (suggested)
- **Scene 1 — Intro:** image slide (title) full-screen
- **Scene 2 — Terminal:** full-screen terminal window (Windows Terminal, dark theme)
- **Scene 3 — Code:** VS Code with the file open, font 18+
- **Scene 4 — Dashboard:** full-screen browser
- You can build the diagram slides in draw.io / PowerPoint / Excalidraw and screenshot them.

### Pro tips
1. **Record in segments**, one per scene — cut between scenes in editing. Much easier than one
   perfect take.
2. **Fix the demo before recording**: run every curl once first, so there are no surprises.
3. **Keep the mouse still** while talking; move it only when pointing at things.
4. **Pause 2–3 seconds** at the start of each segment before speaking (easy edit point).
5. Simple edits: CapCut / DaVinci Resolve (free) — just cut at pauses and add the title card.
6. **Speed check:** read the script aloud once with a timer — 750 words should land at ~5 min.

### Backup plan if something fails during the demo
- Health check 200, POST returns 400: check the JSON syntax in the terminal (paste from this
  file to avoid typos).
- Aggregate returns empty buckets: seed first — `npx tsx scripts/seed.ts`.
- Docker not running: open Docker Desktop and wait for "Engine running" before `docker compose up`.
