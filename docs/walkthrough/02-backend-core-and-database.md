## src/index.ts

This is the process entry point: the file that actually gets executed when the container/process starts. Its whole job is orchestration — make sure the database is reachable, make sure the schema is up to date, then start accepting HTTP traffic. It depends on `app.ts` (the configured Express app), `db/index.ts` (the connection pool), and `db/migrate.ts` (schema setup); nothing else in the codebase depends on it, since it is the top of the dependency graph.

```ts
import app from "./app.js";
import { pool } from "./db/index.js";
import { migrate } from "./db/migrate.js";
```
Lines 1-3. Three imports pulling in the pieces this file coordinates. Note the `.js` extensions on relative specifiers even though the actual files are `.ts` — the project's `tsconfig.json` uses `"module": "nodenext"`, which enforces Node's native ESM resolution rules at the type-checking level. Node ESM requires the extension the *emitted* file will have, so TypeScript makes you write `.js` and rewrites nothing; `tsx` (used to run the project, per `package.json`) resolves these correctly at runtime.

```ts
const PORT = 8080;
```
Line 5. The HTTP port is hardcoded rather than read from an environment variable. This is inconsistent with how the DB connection is configured (see `db/index.ts` below, which does read `DB_HOST`/`DB_PORT`), so changing the listen port requires editing source rather than an env var/config change.

```ts
async function waitForDb(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("DB not reachable after 60s");
}
```
Lines 7-17. A polling retry loop: up to 60 attempts, one second apart, trying a trivial `SELECT 1` against the pool. Any failure (connection refused, DNS not resolved yet, etc.) is silently swallowed in the `catch` and the loop just waits and retries. If all 60 attempts fail, it throws. This pattern exists because in a typical Docker Compose setup the app container can start before the Postgres/TimescaleDB container has finished initializing and started accepting connections — without this loop the very first `pool.query` call anywhere in the app would fail immediately on a fresh `docker compose up`.

```ts
async function start(): Promise<void> {
  await waitForDb();
  await migrate();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}
```
Lines 19-25. The startup sequence, strictly ordered: confirm connectivity, run migrations (`migrate()` — covered below — creates tables, converts `logs` into a hypertable, and builds indexes), and only then start listening for HTTP requests. This ordering guarantees the very first request the server can serve arrives after the schema is guaranteed to exist.

```ts
start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
```
Lines 27-30. Top-level invocation of `start()`. Because `start` is `async`, any rejection (DB never became reachable, migration SQL error, etc.) is caught here, logged, and turned into a hard process exit with a non-zero code — this is what makes the container/process management layer (e.g. Docker's restart policy) aware that startup failed, rather than leaving an unhandled promise rejection that Node would otherwise just warn about.

One important side effect worth flagging: because `import app from "./app.js"` on line 1 is a static ES module import, its module body executes immediately when this file is loaded — *before* `start()` runs. That means whatever side effects `app.ts` performs at import time (see `startRetentionJob()`/`startAlertJob()` below) begin before `waitForDb()`/`migrate()` have completed, not after.

## src/app.ts

This file builds and configures the Express application object: middleware, static file serving, page routes, and mounting of all the feature routers (`health`, `logs`, `alerts`, `auth`, `notifications`, `support`). It depends on those routers plus `authController.checkAuth` for gating pages, and on `retentionService`/`alertService` for background jobs. It is imported by `src/index.ts`, which attaches it to an actual TCP listener.

```ts
import express from "express";
import session from "express-session";
import healthRouter from "./routes/health.js";
import logsRouter from "./routes/logs.js";
import { startRetentionJob } from "./services/retentionService.js";
import { startAlertJob } from "./services/alertService.js";
import alertsRouter from "./routes/alerts.js";
import notificationsRouter from "./routes/notifications.js";
import authRouter from "./routes/auth.js";
import supportRouter from "./routes/support.js";
import { checkAuth } from "./controllers/authController.js";
```
Lines 1-11. Straightforward import block: the Express framework, the session middleware, one router per feature area, the two background-job starter functions, and the `checkAuth` middleware used below to gate dashboard pages. All relative imports use the `.js` extension for the same NodeNext-resolution reason discussed in `index.ts`.

```ts
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```
Lines 13-15. Since this project runs as native ESM (`"type": "module"` in `package.json`), the CommonJS globals `__dirname`/`__filename` don't exist; this is the standard shim that reconstructs a directory path from `import.meta.url`. Notably, `__dirname` is computed here but **never referenced again anywhere else in this file** (confirmed by searching the rest of `app.ts` and the rest of `src/`) — the static-file base path a few lines down uses `process.cwd()` instead. This line is effectively dead code as currently written.

```ts
const app = express();
app.use(express.json());
```
Lines 16-17. Creates the Express application instance, then registers the built-in JSON body parser globally so every route handler downstream can read `req.body` for JSON payloads (used by, e.g., the login route in `authController`).

```ts
app.use(
    session({
        secret: process.env.SESSION_SECRET || "dev-secret-change-me",
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 24 * 60 * 60 * 1000 },
    })
);
```
Lines 18-25. Registers `express-session` globally. `secret` signs the session cookie and comes from `SESSION_SECRET`, falling back to an obviously-insecure default (`"dev-secret-change-me"`) if unset — fine for local dev, a real risk if that fallback is ever hit in production. `resave: false` avoids re-saving sessions that haven't changed; `saveUninitialized: false` avoids creating a session store entry until something is actually written to the session (keeps anonymous visitors from generating empty session rows/cookies). `cookie.maxAge` is `24 * 60 * 60 * 1000` = one day in milliseconds, so a logged-in session naturally expires after 24 hours.

```ts
const PUBLIC = path.join(process.cwd(), "public");
```
Line 27. Computes the static assets directory relative to the *current working directory* the process was launched from, not relative to this source file's location (which is what `__dirname` above would have given). This means the app must always be launched from the repository root (or wherever `public/` actually lives) — it's not location-independent the way `db/migrate.ts` (see below) is.

```ts
const authPage = (file: string) => (req: any, res: any) => {
  res.sendFile(path.join(PUBLIC, file));
};
```
Lines 28-30. A small curried helper: given a filename, returns an Express route handler that serves that static file from `PUBLIC`. This exists to avoid repeating `(req, res) => res.sendFile(path.join(PUBLIC, "x.html"))` for every gated dashboard page below. Note the handler's parameters are typed `any`, opting out of Express's request/response typing for this helper.

```ts
app.get("/login.html", (req, res) => res.sendFile(path.join(PUBLIC, "login.html")));
app.get("/", (req, res) => res.redirect("/logs-explorer"));
app.get("/dashboard", (req, res) => res.redirect("/logs-explorer"));
app.get("/logs-explorer", checkAuth, authPage("logs-explorer.html"));
app.get("/analytics", checkAuth, authPage("analytics.html"));
app.get("/ingestion", checkAuth, authPage("ingestion.html"));
app.get("/retention", checkAuth, authPage("retention.html"));
app.get("/history", checkAuth, authPage("retention.html"));
app.get("/docs", (req, res) => res.sendFile(path.join(PUBLIC, "docs.html")));
app.get("/support", (req, res) => res.sendFile(path.join(PUBLIC, "support.html")));
```
Lines 31-40, the page-routing table:
- Line 31 (`/login.html`): serves the login page directly, inlining the same `sendFile` logic the `authPage` helper wraps, rather than calling `authPage("login.html")`. It is deliberately **not** behind `checkAuth` — a logged-out user must be able to reach the login page, or nobody could ever authenticate.
- Line 32 (`/`) and line 33 (`/dashboard`): both just redirect to `/logs-explorer` rather than serving any content themselves, i.e. `logs-explorer` is treated as the "home" dashboard view.
- Lines 34-37: the actual dashboard pages (`logs-explorer`, `analytics`, `ingestion`, `retention`), each gated by `checkAuth` before `authPage(...)` runs — Express middleware chains left to right, so an unauthenticated request never reaches `authPage` and is redirected to `/login.html` by `checkAuth` instead (per `authController.ts`).
- Line 38 (`/history`): reuses the *same* static file as `/retention` (`retention.html`) — this is an alias route, not a distinct page; the frontend HTML/JS presumably differentiates behavior client-side or `/history` is a legacy/alternate name for the same view.
- Line 39 (`/docs`) and line 40 (`/support`): served without `checkAuth`, meaning documentation and the support page are publicly reachable without logging in, unlike the operational dashboard pages above.

```ts
app.use(express.static(PUBLIC));
```
Line 41. Registered *after* all the explicit page routes above, so any of those explicit routes take precedence over a same-named static file; this line's job is to serve the remaining static assets (CSS, client-side JS, images) referenced by the HTML pages, which have no matching explicit route.

```ts
app.use("/health", healthRouter);
app.use("/logs", logsRouter);
app.use("/alerts", alertsRouter);
app.use("/auth", authRouter);
app.use("/notifications", notificationsRouter);
app.use("/support", supportRouter);
```
Lines 42-47. Mounts each feature router under its own path prefix — this is the actual JSON/API surface of the service (as opposed to the HTML page routes above). Worth noting: `/support` is used both as a static HTML page route (line 40, exact match on `GET /support`) *and* as a router mount point (line 47, matching `/support/*` and, depending on Express's route-matching, potentially colliding with `GET /support` again if `supportRouter` also defines a `/` route — since line 40 is registered first, it wins for the exact path).

```ts
startRetentionJob();
startAlertJob();
export default app;
```
Lines 49-51. Starts the two background jobs (log retention cleanup and alert-rule evaluation, defined in their respective service modules) and exports the configured `app` object as the module's default export, to be consumed by `src/index.ts`. As noted above, because these two calls run during module evaluation (i.e., as soon as something `import`s `app.ts`), they fire before `src/index.ts`'s `waitForDb()`/`migrate()` sequence completes — the jobs' first tick could in principle race against an unready or unmigrated database.

## src/db/index.ts

This is the single shared `pg` connection pool for the whole application — every module that needs to talk to Postgres (`migrate.ts`, the route/controller/service layers, etc.) imports `pool` from here rather than constructing its own. It depends only on the `pg` package; nearly everything else in `src/` depends on it transitively.

```ts
import { Pool } from "pg";
```
Line 1. Named import of the `Pool` class from `node-postgres`. A `Pool` manages a set of reusable client connections rather than opening a new TCP connection per query.

```ts
export const pool = new Pool({
  user: "loguser",
  password: "logpass",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5433", 10),
  database: "logdb",
});
```
Lines 3-9. Constructs and exports a single module-level `Pool` instance, so importing this file anywhere in the process reuses the same pool (Node's module cache guarantees the initializer runs once). Field by field:
- `user: "loguser"` and `password: "logpass"` and `database: "logdb"` are hardcoded literal strings rather than read from environment variables — this only works because these values happen to match whatever the actual database is provisioned with (e.g. a Docker Compose service). This is inconsistent with `scripts/seed.ts` (below), which reads all five of these fields from environment variables with the same literal values only used as *fallback* defaults.
- `host: process.env.DB_HOST || "localhost"`: overridable via `DB_HOST`, defaulting to `localhost` for local (non-containerized) runs.
- `port: parseInt(process.env.DB_PORT || "5433", 10)`: overridable via `DB_PORT`, parsed to an integer with an explicit radix of 10 (good practice to avoid octal-parsing surprises on strings with leading zeros); defaults to `5433`, a non-default Postgres port, which strongly suggests the local/dev Postgres container is deliberately mapped off the standard `5432` to avoid colliding with a developer's own locally-installed Postgres.

Because `user`, `password`, and `database` can't be overridden here without editing source, this module is effectively tied to one specific set of credentials/database name; only host and port are meant to vary between environments (e.g. pointing at a different container host).

## src/db/migrate.ts

This module is responsible for bringing the database schema up to date on every process startup: creating tables if they don't exist, converting the `logs` table into a TimescaleDB hypertable, and creating supporting indexes. It's called once from `src/index.ts` before the HTTP server starts accepting traffic. It depends on `db/index.ts` for the connection pool and on the two SQL files (`schema.sql`, `indexes.sql`) sitting alongside it.

```ts
import { readFileSync } from "fs";
import { pool } from "./index.js";
```
Lines 1-2. Synchronous file read (fine here since this only runs once at startup, not on a request path) and the shared pool from the sibling module.

```ts
export async function migrate(): Promise<void> {
```
Line 4. The single exported entry point, an async function so its caller (`index.ts`) can `await` it before proceeding to `app.listen`.

```ts
  const schema = readFileSync(new URL("schema.sql", import.meta.url), "utf-8");
  await pool.query(schema);
```
Lines 5-6. Reads `schema.sql` as UTF-8 text and executes it. The path is resolved via `new URL("schema.sql", import.meta.url)` — i.e., relative to *this module's own location on disk* — rather than via `process.cwd()` (contrast with `app.ts`'s `PUBLIC` path above). This makes migration reliable regardless of what directory the process happens to be launched from. Passing the whole file as one string to `pool.query` with no second (`values`) argument causes `node-postgres` to send it as a "simple query," which — unlike the extended/parameterized query protocol — supports multiple semicolon-separated statements in a single call; this is what allows `schema.sql`'s three `CREATE TABLE` statements to run in one `pool.query`.

```ts
  await pool.query(
    "SELECT create_hypertable('logs', 'timestamp', if_not_exists => TRUE, migrate_data => TRUE)"
  );
```
Lines 8-10. Calls TimescaleDB's `create_hypertable()` function to convert the plain `logs` table into a hypertable partitioned (chunked) on its `timestamp` column. `if_not_exists => TRUE` makes this call idempotent — safe to run on every process startup even if `logs` is already a hypertable, instead of erroring. `migrate_data => TRUE` allows the conversion to succeed even if `logs` already contains rows (normally TimescaleDB requires converting an empty table), by migrating existing rows into the newly created chunks. This statement must run after `schema.sql` has created the `logs` table and before `indexes.sql` builds indexes on it.

```ts
  const indexes = readFileSync(new URL("indexes.sql", import.meta.url), "utf-8");
  await pool.query(indexes);
```
Lines 12-13. Same pattern as the schema file: read `indexes.sql` relative to this module's location and execute it as a multi-statement simple query. Because `logs` is already a hypertable by this point, any index created here is automatically propagated to all existing and future chunks by TimescaleDB.

```ts
  console.log("Migration complete");
}
```
Lines 15-16. A simple console log marking successful completion, visible in process/container logs to confirm startup got past this stage.

## src/db/schema.sql

This file defines the three base tables the whole application is built on: `logs` (the actual ingested log records, later converted to a hypertable by `migrate.ts`), `alert_rules` (user-configured thresholds for alerting), and `notifications` (generated alerts/messages surfaced in the dashboard). It's executed verbatim by `db/migrate.ts` via `pool.query`, and every route/service/controller that reads or writes log data, alert rules, or notifications ultimately depends on the shapes defined here.

```sql
CREATE TABLE IF NOT EXISTS logs (
  id SERIAL,
  timestamp TIMESTAMPTZ NOT NULL,
  level TEXT NOT NULL,
  service TEXT NOT NULL,
  message TEXT NOT NULL,
  attributes JSONB,
  PRIMARY KEY (id, timestamp)
);
```
Lines 1-9, the core `logs` table:
- `IF NOT EXISTS` (line 1): makes table creation idempotent across repeated migration runs (every process startup).
- `id SERIAL` (line 2): an auto-incrementing integer surrogate key, but notably **not** declared `PRIMARY KEY` by itself.
- `timestamp TIMESTAMPTZ NOT NULL` (line 3): the column TimescaleDB partitions on (see `migrate.ts`'s `create_hypertable('logs', 'timestamp', ...)`). `TIMESTAMPTZ` stores an absolute point in time (normalized to UTC internally, converted on display), avoiding timezone-ambiguity bugs that a bare `TIMESTAMP` would have. `NOT NULL` is required — TimescaleDB cannot partition rows that lack a value in the partitioning column.
- `level TEXT NOT NULL` (line 4): the log severity (`debug`/`info`/`warn`/`error` per `seed.ts`'s usage), stored as unconstrained text rather than an enum — flexible but doesn't validate allowed values at the DB layer.
- `service TEXT NOT NULL` (line 5): the emitting service's name, used heavily for filtering (see `indexes.sql`).
- `message TEXT NOT NULL` (line 6): the free-form human-readable log line.
- `attributes JSONB` (line 7): a nullable, schema-less bag for arbitrary structured metadata (e.g. `region`, `request_id`, `user_id`, `duration_ms`, `transaction_id`, per `seed.ts`'s `randomAttributes`). `JSONB` (binary JSON) is used instead of `JSON` because it supports indexing and containment operators, even though this schema currently only queries it via `->>` text extraction (see `indexes.sql`'s comment about this).
- `PRIMARY KEY (id, timestamp)` (line 8): a *composite* primary key including the partitioning column. This is a TimescaleDB requirement — any primary key (or unique constraint) on a hypertable must include the partitioning column, because uniqueness can only be enforced within a chunk, not across the whole logically-partitioned table. This is exactly why `id` alone isn't the primary key here.

```sql
CREATE TABLE IF NOT EXISTS alert_rules (
  id SERIAL PRIMARY KEY,
  service TEXT,
  threshold INT NOT NULL,
  window_minutes INT NOT NULL,
  webhook_url TEXT NOT NULL,
  last_triggered_at TIMESTAMPTZ
);
```
Lines 11-18, `alert_rules` — a plain (non-hypertable) table holding user-defined alerting rules:
- `id SERIAL PRIMARY KEY` (line 12): here `id` alone can be the primary key since this table is never turned into a hypertable.
- `service TEXT` (line 13): nullable, unlike `logs.service` — a null value here presumably means "match any service," i.e. a rule scoped to a specific service is optional.
- `threshold INT NOT NULL` (line 14) and `window_minutes INT NOT NULL` (line 15): together define the rule's condition, something like "trigger if more than `threshold` matching log events occur within `window_minutes`" — evaluated by the alert-checking background job (`startAlertJob`, mounted from `app.ts`).
- `webhook_url TEXT NOT NULL` (line 16): where to deliver the alert when the rule fires; required, since a rule with nowhere to send an alert would be useless.
- `last_triggered_at TIMESTAMPTZ` (line 17): nullable, presumably used to implement a cooldown/debounce so the same rule doesn't fire repeatedly every evaluation tick.

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  service TEXT,
  level TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```
Lines 20-29, `notifications` — likely the record of alerts (and possibly other system messages) surfaced in the dashboard's notification UI:
- `id SERIAL PRIMARY KEY` (line 21): simple surrogate key, again not a hypertable.
- `type TEXT NOT NULL` (line 22): presumably distinguishes categories of notification (e.g. an alert-rule trigger vs. some other system event), though no enum/check constraint enforces specific values.
- `title TEXT NOT NULL` (line 23) and `message TEXT NOT NULL` (line 24): the display content.
- `service TEXT` (line 25) and `level TEXT` (line 26): both nullable — optional context linking a notification back to the log data that triggered it (e.g. which service, and at what severity), left null for notifications not tied to a specific service/level.
- `is_read BOOLEAN DEFAULT FALSE` (line 27): dashboard read/unread state, defaulting to unread on insert.
- `created_at TIMESTAMPTZ DEFAULT NOW()` (line 28): server-side timestamp defaulting to insertion time, so callers don't need to supply it explicitly.

## src/db/indexes.sql

This file creates the indexes that make common query patterns over `logs` fast, and is executed by `db/migrate.ts` immediately after the table is converted into a hypertable (so these indexes exist across all chunks). It depends only on the `logs` table shape from `schema.sql` and the `pg_trgm` extension it enables itself.

```sql
-- index للفلترة السريعة حسب service
CREATE INDEX IF NOT EXISTS idx_logs_service ON logs (service, timestamp DESC);
```
Lines 1-2. The comment (in Arabic) translates to "index for fast filtering by service." The index itself is a composite B-tree on `(service, timestamp DESC)`. This ordering optimizes the very common query shape "give me the most recent logs for service X" — Postgres can use the index to jump straight to the rows matching a given `service` value and read them back already in descending timestamp order, avoiding a separate sort step. On a hypertable, TimescaleDB creates this same index on every chunk, and combined with a `WHERE timestamp >= ...` range filter in a query, the planner can additionally skip entire chunks outside the requested time range (chunk exclusion) before this index is even consulted within the remaining chunks.

```sql
-- index للفلترة السريعة حسب level
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs (level, timestamp DESC);
```
Lines 4-5. Comment translates to "index for fast filtering by level." Same structural pattern as the `service` index, but for filtering by severity level (e.g. "show me the most recent `error` logs"), again with `timestamp DESC` to satisfy typical "most recent first" ordering without an extra sort.

```sql
-- attr.<key> filters use `attributes ->> key = value` (text comparison) so mixed
-- string/number/boolean attribute values compare correctly. A generic GIN index only
-- accelerates the `@>` containment operator, not `->>`, and `->>` can't be indexed
-- generically since the key is dynamic per-request. We rely on TimescaleDB chunk
-- exclusion from the required since/until range to keep these scans bounded instead.
DROP INDEX IF EXISTS idx_logs_attributes;
```
Lines 7-12. This is a substantial explanatory comment (already in English) documenting a deliberate design decision, followed by an index *removal*. It explains that queries filtering on JSONB attribute values use the `->>` (extract-as-text) operator — e.g. `attributes ->> 'user_id' = '123'` — rather than the `@>` containment operator, specifically so that values stored as strings, numbers, or booleans in the JSONB can all be compared as text uniformly. The comment notes a real limitation: a generic GIN index on a JSONB column accelerates `@>` containment lookups, not `->>` text-extraction lookups, and since the attribute *key* being filtered on is chosen dynamically per request (not fixed at schema-design time), you can't build a single-key expression index to cover it either. Given that, the team decided a GIN index here would be dead weight and instead relies on TimescaleDB's chunk exclusion (pruning chunks entirely outside a query's required time range) to bound how much data these `attributes` filters ever need to scan. `DROP INDEX IF EXISTS idx_logs_attributes` then removes a (presumably previously-created) GIN index of that name — `IF EXISTS` makes this safe to run even in environments where it was never created, and safe to re-run on every migration.

```sql
-- trigram GIN index لتسريع البحث بالـ ILIKE '%q%' على message
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_logs_message_trgm ON logs USING GIN (message gin_trgm_ops);
```
Lines 14-16. Comment translates to "trigram GIN index to speed up `ILIKE '%q%'` search on message." `CREATE EXTENSION IF NOT EXISTS pg_trgm` (line 15) enables Postgres's trigram module, which breaks text into overlapping three-character sequences and is what makes trigram-based indexing/operators available at all; `IF NOT EXISTS` avoids an error if it's already enabled. `CREATE INDEX ... USING GIN (message gin_trgm_ops)` (line 16) builds a GIN index over `message` using the trigram operator class. This specifically targets the free-text search pattern used elsewhere in the app (`message ILIKE '%searchterm%'`) — a query with a leading wildcard that a normal B-tree index cannot accelerate at all, but which a trigram GIN index can, by matching on shared three-character fragments between the search term and stored messages.

## scripts/seed.ts

A standalone script (run manually via `npx tsx scripts/seed.ts`, not imported by the running server) that bulk-inserts one million synthetic log rows into the `logs` table for load/performance testing. It depends only on the `pg` package (it builds its own connection pool rather than reusing `db/index.ts`) and on the `logs` table shape from `schema.sql` already existing (i.e., migrations must have already run).

```ts
/**
 * seed.ts — inserts 1,000,000 log rows for load-testing
 * Usage:  npx tsx scripts/seed.ts
 * Env:    DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME (or defaults below)
 */
```
Lines 1-5. A doc comment describing the script's purpose, how to invoke it, and which environment variables configure it — useful since this script is meant to be run ad hoc by a developer, not automatically by the app.

```ts
import pg from "pg";

const { Pool } = pg;
```
Lines 7-9. Imports the `pg` package's default export and destructures `Pool` from it, rather than using the named import (`import { Pool } from "pg"`) that `db/index.ts` uses. Both forms work with `pg`'s CommonJS/ESM interop; this script simply takes the default-import route.

```ts
const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5433", 10),
  user: process.env.DB_USER || "loguser",
  password: process.env.DB_PASSWORD || "logpass",
  database: process.env.DB_NAME || "logdb",
});
```
Lines 11-17. Builds its own independent connection pool (it does not import the shared `pool` from `db/index.ts`), and — unlike `db/index.ts` — makes *every* field overridable via an environment variable (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`), falling back to the same literal defaults (`localhost`/`5433`/`loguser`/`logpass`/`logdb`) used elsewhere. This makes sense for a script meant to be pointed at different environments (e.g. a remote staging DB) without editing source.

```ts
const SERVICES = ["checkout", "auth", "inventory-api", "payment-gateway", "frontend-web", "worker-node", "proxy-ingress", "database-master"];
const LEVELS   = ["debug", "info", "info", "info", "warn", "warn", "error"] as const;
```
Lines 19-20. `SERVICES` is a fixed list of plausible microservice names used to populate the `service` column with realistic-looking values. `LEVELS` deliberately repeats `"info"` three times and `"warn"` twice against a single `"debug"` and `"error"`, so that a uniformly-random pick from this array is weighted to look like a realistic log-level distribution (mostly info, some warnings, fewer errors/debug) rather than a flat 1-in-4 split. `as const` narrows the array's type to a tuple of literal string types instead of `string[]`.

```ts
const MESSAGES = [
  "User session validated successfully",
  ...
  "Config reload triggered via SIGHUP",
];
```
Lines 21-37. Fifteen canned, realistic-sounding log message strings spanning auth, payments, infrastructure, and rate-limiting scenarios — used as raw material so seeded data resembles genuine application logs rather than obviously-fake placeholder text.

```ts
const TOTAL_ROWS  = 1_000_000;
const BATCH_SIZE  = 1_000;
```
Lines 39-40. `TOTAL_ROWS` is the overall target row count for the load test. `BATCH_SIZE` controls how many rows are combined into a single multi-row `INSERT` statement — batching avoids both the overhead of 1,000,000 separate round-trip queries and the risk of building one single unmanageably large statement/parameter list.

```ts
function randomElement<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
```
Lines 42-44. A generic helper that returns a uniformly random element from any array (accepting `readonly T[]` so it also works with the `as const` `LEVELS` tuple). The trailing `!` is a non-null assertion, telling TypeScript to trust that the computed index is always in bounds (true here since `Math.floor(Math.random() * arr.length)` is always `< arr.length`) — this is needed because the project's `tsconfig.json` enables `noUncheckedIndexedAccess`, which would otherwise type array element access as possibly `undefined`.

```ts
function randomTimestamp(): Date {
  const msAgo = Math.random() * 30 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - msAgo);
}
```
Lines 46-49. Generates a random point in time somewhere within the last 30 days, by picking a random offset in milliseconds (`Math.random()` scaled by the number of milliseconds in 30 days) and subtracting it from the current time. Spreading seeded rows across a 30-day window (rather than clustering them all "now") produces data that exercises time-range filtering and TimescaleDB's chunking realistically, instead of dumping everything into a single chunk.

```ts
function randomAttributes(service: string): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {
    region: randomElement(["us-east-1", "eu-west-1", "ap-southeast-1"]),
    request_id: `req-${Math.random().toString(36).slice(2, 10)}`,
  };
  if (Math.random() > 0.5) attrs["user_id"] = String(Math.floor(Math.random() * 10000));
  if (Math.random() > 0.6) attrs["duration_ms"] = Math.floor(Math.random() * 5000);
  if (service === "checkout" || service === "payment-gateway") {
    attrs["transaction_id"] = `TX-${Math.floor(Math.random() * 99999)}`;
  }
  return attrs;
}
```
Lines 51-62. Builds the JSONB `attributes` payload for a single row, and deliberately makes it *heterogeneous* to mimic real-world log attribute variability:
- `region` and `request_id` (lines 53-54) are always present — a random AWS-style region string, and a synthetic request id generated by converting a random number to base-36 and slicing out 8 characters.
- Line 56: `user_id` is included only about half the time (`Math.random() > 0.5`), stored as a numeric string.
- Line 57: `duration_ms` is included about 40% of the time (`Math.random() > 0.6`), as an integer 0-4999.
- Lines 58-60: `transaction_id` is added only when the row's `service` is `"checkout"` or `"payment-gateway"`, modeling the fact that only certain services would ever emit a transaction identifier. This is why the function takes `service` as a parameter — the attribute shape depends on which service is "emitting" the synthetic log.

```ts
async function seed() {
  console.log(`Seeding ${TOTAL_ROWS.toLocaleString()} rows in batches of ${BATCH_SIZE}...`);
  const start = Date.now();
```
Lines 64-66. Entry point of the seeding logic. Logs a human-readable start message (`toLocaleString()` adds thousands separators, e.g. `1,000,000`) and records a start timestamp used later to report elapsed time and throughput.

```ts
  for (let offset = 0; offset < TOTAL_ROWS; offset += BATCH_SIZE) {
    const batchSize = Math.min(BATCH_SIZE, TOTAL_ROWS - offset);
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
```
Lines 68-72. Outer loop, one iteration per batch. `batchSize` is clamped with `Math.min` to handle a final partial batch if `TOTAL_ROWS` weren't an exact multiple of `BATCH_SIZE` (here it is exact — 1,000,000 / 1,000 — but the guard makes the script correct for other configurations too). `placeholders` accumulates the `($1, $2, ...)` tuple strings for the SQL `VALUES` clause; `values` accumulates the actual flat list of bound parameters; `idx` tracks the next `$n` placeholder number across the whole batch (since every row consumes 5 placeholders, this can't just be recomputed from the row index alone without tracking a running counter).

```ts
    for (let i = 0; i < batchSize; i++) {
      const service = randomElement(SERVICES);
      placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4})`);
      values.push(
        randomTimestamp().toISOString(),
        randomElement(LEVELS),
        service,
        randomElement(MESSAGES),
        JSON.stringify(randomAttributes(service))
      );
      idx += 5;
    }
```
Lines 74-85. Inner loop, one iteration per row within the batch:
- Line 75: picks a random service once per row, so the same value can be reused both for the `service` column and passed into `randomAttributes` (ensuring `transaction_id` logic stays consistent with the row's actual service).
- Line 76: appends this row's placeholder tuple, e.g. `($1, $2, $3, $4, $5)` for the first row, `($6, $7, $8, $9, $10)` for the second, matching column order `(timestamp, level, service, message, attributes)`.
- Lines 77-83: pushes the five actual bound values in that same order — `randomTimestamp().toISOString()` (a string Postgres parses into `TIMESTAMPTZ`), a random level, the chosen service, a random message, and `JSON.stringify(randomAttributes(service))` (JSONB columns are passed as JSON-text over the wire protocol).
- Line 84: advances `idx` by 5 for the next row's placeholders.

```ts
    await pool.query(
      `INSERT INTO logs (timestamp, level, service, message, attributes) VALUES ${placeholders.join(", ")}`,
      values
    );
```
Lines 87-90. Executes one parameterized multi-row `INSERT` per batch — all `batchSize` rows' placeholder tuples joined with `, ` into a single `VALUES (...), (...), ...` clause, bound against the flat `values` array. This is the classic bulk-insert pattern: it inserts up to 1,000 rows per round-trip instead of one round-trip per row, which is what makes seeding a million rows practical in reasonable time. Using parameterized placeholders (rather than string-interpolating the values into SQL) also avoids SQL injection and lets `pg` handle type conversion/escaping.

```ts
    const done = offset + batchSize;
    if (done % 50_000 === 0 || done === TOTAL_ROWS) {
      const pct = ((done / TOTAL_ROWS) * 100).toFixed(1);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  ${done.toLocaleString()} / ${TOTAL_ROWS.toLocaleString()} rows (${pct}%) -- ${elapsed}s elapsed`);
    }
  }
```
Lines 92-98. After each batch, computes how many rows are done so far and logs progress only every 50,000 rows (or on the very last batch, in case `TOTAL_ROWS` isn't a multiple of 50,000) — this throttling keeps the console output readable instead of printing on every single 1,000-row batch. `pct` and `elapsed` are formatted to one decimal place via `toFixed(1)`.

```ts
  const total = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone! Inserted ${TOTAL_ROWS.toLocaleString()} rows in ${total}s`);
  console.log(`   Avg insert rate: ${(TOTAL_ROWS / parseFloat(total)).toFixed(0)} rows/sec`);
  await pool.end();
}
```
Lines 100-104. After the loop finishes, computes total elapsed seconds and prints a summary including an average throughput figure (rows divided by elapsed seconds) — useful as a quick benchmark signal for how the database/hypertable is performing under bulk insert load. `await pool.end()` closes all pooled connections cleanly, which is necessary for the Node process to be able to exit on its own (an open `pg` pool would otherwise keep the event loop alive).

```ts
seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
```
Lines 106-109. Top-level invocation, mirroring the same catch-and-exit pattern used in `src/index.ts`'s `start().catch(...)` — any error during seeding (e.g. a constraint violation or connection failure) is logged and the process exits with a non-zero status code, making failures visible to whatever invoked the script.
