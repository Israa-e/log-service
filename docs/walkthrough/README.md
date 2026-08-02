# Obsidian Log Engine — Full Code Walkthrough

This is a genuine line-by-line explanation of every source file in this repository, split into one document per area of the codebase so each part stays readable. It was generated to complement the higher-level, interview-style Arabic docs already in `docs/` (`project-explanation-ar.md`, `code-explanation.md`, `interview-prep.md`, `hard-questions.md`) — those answer "what and why" at a conceptual level; this walkthrough answers "what does this exact line do."

## What this project is

Obsidian Log Engine is a self-contained log ingestion, search, and alerting service:

- **Backend:** Node.js + TypeScript + Express 5, talking to **PostgreSQL with the TimescaleDB extension** via the `pg` driver. It exposes a small REST API for writing logs in batches, querying/filtering them with cursor-based pagination, aggregating them into time buckets, running retention (deleting old data), managing webhook-based alert rules, and a simple session-based login.
- **Frontend:** No framework — plain server-rendered static HTML pages under `public/`, styled with the Tailwind CDN build plus a hand-written `styles.css` for theme tokens and small utilities, and a single shared `app.js` for cross-page behavior (theme toggle, notifications, modals, drawers, toasts). Charts use ECharts (loaded from a CDN in the pages that need it).
- **Ops:** Docker + docker-compose for local/CI runs (app container + a TimescaleDB container), a GitHub Actions workflow that builds the stack and smoke-tests the API on every push, and a small `load-test.js` script (using `autocannon`) for basic throughput testing.

## How to read this

Each file below covers a specific slice of the codebase. Within a file, look for a `##`/`###` heading naming the exact source path, then a short summary of that file's role, followed by the line-by-line walkthrough itself (quoted code + explanation, with real line numbers you can jump to in your editor).

Several agents wrote these documents independently and in parallel, each reading the actual source before writing — so treat any specific line number as accurate as of when these docs were generated, but re-check against the live file if the code has since changed.

| # | File | Covers | What's in it |
|---|---|---|---|
| 02 | [`02-backend-core-and-database.md`](./02-backend-core-and-database.md) | `src/index.ts`, `src/app.ts`, `src/db/index.ts`, `src/db/migrate.ts`, `src/db/schema.sql`, `src/db/indexes.sql`, `scripts/seed.ts` | Server startup sequence, Express app wiring (sessions, static files, route mounting, protected pages), the Postgres connection pool, the migration runner, the three tables (`logs`, `alert_rules`, `notifications`), the TimescaleDB hypertable, all indexes (including the trigram index for text search and why a JSONB GIN index was dropped), and the seed script. |
| 03 | [`03-routes.md`](./03-routes.md) | `src/routes/*.ts` | Every Express router: what HTTP surface each one exposes and how it delegates to controllers (or, for the smaller ones, handles the request inline). |
| 04 | [`04-controllers.md`](./04-controllers.md) | `src/controllers/*.ts` | Request/response handling for logs, auth (login/logout/session/`checkAuth` middleware), and alert rules — exact status codes and error paths. |
| 05 | [`05-services.md`](./05-services.md) | `src/services/*.ts` | The business logic layer: log validation + dynamic batch INSERT building, cursor-paginated `queryLogs`, `time_bucket`-based `queryAggregate`, the retention batch-delete job, the alert-checking job and webhook firing, the notifications data layer, and the OpenRouter-backed support chat service. |
| 06 | [`06-frontend-app-js.md`](./06-frontend-app-js.md) | `public/app.js` | The shared client-side script loaded on every dashboard page: theme system, `fetchJSON`, CSV export, time/level formatting helpers, log row rendering, logout, drawer helpers, the notifications panel, and the large IIFE that injects shared CSS and wires up the Add-Log modal, Docs drawer, and Support chat drawer. |
| 07 | [`07-frontend-styles-and-tailwind.md`](./07-frontend-styles-and-tailwind.md) | `public/styles.css`, `public/tailwind-config.js` | The Material-3-style CSS variable token system (light/dark pairs), scrollbar/animation/utility classes, and the Tailwind config that maps utility classes onto those same CSS variables. |
| 08 | [`08-frontend-pages-small.md`](./08-frontend-pages-small.md) | `public/index.html`, `login.html`, `support.html`, `docs.html`, `dashboard.html` | The redirect landing page, login page, and the support/docs/dashboard pages — markup plus any inline script logic. |
| 09 | [`09-frontend-pages-retention-ingestion.md`](./09-frontend-pages-retention-ingestion.md) | `public/retention.html`, `public/ingestion.html` | The retention dashboard (storage stats, ECharts volume chart, run-retention button) and the settings page (despite its filename, `ingestion.html` is actually the General/Ingestion/Storage settings tabs — noted explicitly in the doc). |
| 10 | [`10-frontend-analytics.md`](./10-frontend-analytics.md) | `public/analytics.html` | The analytics page: volume-trend chart, error-distribution bars, and the aggregation table with client-side filter/sort/pagination — flagged where the data is simulated rather than pulled from the real API. |
| 11 | [`11-frontend-logs-explorer.md`](./11-frontend-logs-explorer.md) | `public/logs-explorer.html` | The main log search page: filter bar, `renderLogs()`'s query construction against `GET /logs`, the detail drawer, and the pagination/ellipsis algorithm. |
| 12 | [`12-devops-and-config.md`](./12-devops-and-config.md) | `Dockerfile`, `docker-compose.yml`, `src/.dockerignore`, `.github/workflows/ci.yml`, `package.json`, `tsconfig.json`, `.gitignore`, `load-test.js` | How the app is built, containerized, tested in CI, and load-tested; every dependency and script in `package.json` explained against how it's actually used in the source. |

## A few things worth knowing going in

- **Tech stack:** Express 5, `pg` (raw SQL, no ORM), `express-session`, TypeScript run directly via `tsx` (no build step) — see [`package.json`'s dependencies](./12-devops-and-config.md).
- **No ORM / query builder:** all SQL is hand-written with parameterized queries (`$1, $2, ...`), including dynamically-built `WHERE` clauses and `INSERT` value lists — see [`05-services.md`](./05-services.md).
- **Auth is a single shared dashboard password** (`DASHBOARD_PASSWORD` env var) behind `express-session`, not per-user accounts — see [`04-controllers.md`](./04-controllers.md).
- **Frontend has no build step or framework** — pages are plain HTML/JS served statically by Express, and some pages (noted per-file above) contain leftover mock/simulated data or minor dead code that the individual docs call out explicitly rather than silently smoothing over.
- Environment variables and any secret values are intentionally **not** reproduced in these docs — only their names and purpose are described, based on how the code reads `process.env.*`.
