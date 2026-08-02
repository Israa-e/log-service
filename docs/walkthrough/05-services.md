## src/services/alertService.ts

This file implements the alerting subsystem: it periodically scans the `alert_rules` table, counts recent error logs against each rule's threshold, fires an outbound webhook when a rule trips, and records an in-app notification. It also exposes CRUD-style helpers (`createAlertRule`, `listAlertRules`) used by the alert-rules API routes. The core loop is driven by a `setInterval` job rather than a queue or cron library.

- **Lines 1-2** import the shared `pool` (the pg connection pool) and `createNotification` from `notificationService.ts`, since a triggered alert also creates a user-facing notification.
- **Line 3-4**: `checkAlerts()` starts by loading every row from `alert_rules` with `SELECT * FROM alert_rules` — there is no filtering or pagination, so this assumes the rules table stays small. (Note the stray extra indentation on line 4, purely cosmetic.)
- **Line 6**: `for (const rule of rules.rows)` iterates every rule sequentially (not in parallel), so one slow webhook can delay the checking of subsequent rules within the same run.
- **Lines 7-8** build the base SQL condition array for counting matching error logs:
  - `level = 'error'` is hardcoded — this job only ever alerts on errors, never warn/info/debug.
  - `timestamp >= NOW() - ($1 || ' minutes')::interval` is a parameterized dynamic interval: it string-concatenates the numeric `$1` parameter with the literal `' minutes'` inside SQL, then casts the resulting text (e.g. `"15 minutes"`) to an `interval` type via `::interval`. This is how a variable time window is expressed without string-interpolating the number directly into the SQL text.
  - `values = [rule.window_minutes]` supplies `$1`.
- **Lines 10-13**: if the rule has a `service` scope, a second condition `service = $2` is appended and `rule.service` pushed onto `values`. If the rule has no service, the count is across all services.
- **Lines 15-18** run the count query: `SELECT COUNT(*) FROM logs WHERE ${conditions.join(" AND ")}`. Two concrete shapes result:
  - Without a service scope: `SELECT COUNT(*) FROM logs WHERE level = 'error' AND timestamp >= NOW() - ($1 || ' minutes')::interval` with `values = [window_minutes]`.
  - With a service scope: `... WHERE level = 'error' AND timestamp >= NOW() - ($1 || ' minutes')::interval AND service = $2` with `values = [window_minutes, service]`.
- **Line 20**: `errorCount` is parsed from the string count Postgres returns (`COUNT(*)` comes back as text via node-postgres).
- **Line 22**: if `errorCount >= rule.threshold`, the rule has tripped.
- **Lines 23-28** implement de-duplication ("don't repeat the same alert if it fired in the last 10 minutes", per the Arabic comment on line 23): if `rule.last_triggered_at` is set, the code computes elapsed minutes since that timestamp; if less than 10 minutes have passed, `continue` skips straight to the next rule — no webhook, no DB update, no notification for this rule this cycle.
- **Lines 30-52**: the webhook-and-record logic runs in a `try/catch` so a failure for one rule doesn't abort the whole `checkAlerts()` run:
  - **Lines 31-42**: `fetch(rule.webhook_url, ...)` POSTs a JSON payload with `alert: "error_threshold_exceeded"`, `service` (or the literal string `"all"` if unscoped), `error_count`, `threshold`, `window_minutes`, and an ISO `triggered_at` timestamp. Note the response is never checked with `response.ok` — a webhook endpoint returning 404/500 is treated the same as success, since `fetch` only rejects on network-level failures, not HTTP error statuses.
  - **Lines 44-46**: `UPDATE alert_rules SET last_triggered_at = NOW() WHERE id = $1` records that this rule fired, which drives the 10-minute suppression window on the next run. Because this update happens only if the `fetch` call didn't throw, a genuine network failure leaves `last_triggered_at` unchanged, so the very next check cycle (60s later by default) could immediately retry the same alert.
  - **Line 48**: calls `createNotification("alert", ...)` with a title `Alert: <service or "all">` and a message summarizing the counts, tagging it with the rule's service and severity `"error"`.
  - **Line 49**: logs success to console.
  - **Lines 50-52**: `catch` logs the error to `console.error` and swallows it — the loop proceeds to the next rule.
- **Lines 58-62**: `startAlertJob(intervalMs = 60_000)` wires `checkAlerts()` into `setInterval`, defaulting to a 60-second cadence. Each invocation's promise is followed by `.catch(...)` so an unhandled rejection inside `checkAlerts()` can't crash the interval timer or the process.
- **Lines 65-82**: `createAlertRule(rule)` validates that `threshold`, `window_minutes`, and `webhook_url` are all truthy (line 71), throwing otherwise. Note this means a `threshold` of `0` is incorrectly rejected by `!rule.threshold`, since `0` is falsy — an edge case bug for anyone trying to alert on any single error. On success it runs a parameterized `INSERT INTO alert_rules (service, threshold, window_minutes, webhook_url) VALUES ($1, $2, $3, $4) RETURNING *` (lines 76-78), defaulting `service` to `null` if not provided, and returns the inserted row.
- **Lines 83-86**: `listAlertRules()` returns all rules ordered by `id DESC` (newest first), with no pagination.

## src/services/logsService.ts

This is the core query-building module of the log engine: it validates and bulk-inserts incoming log entries, serves paginated log searches with cursor-based (keyset) pagination, and computes time-bucketed aggregates for the analytics dashboard using TimescaleDB's `time_bucket()`. Nearly all SQL here is assembled dynamically — conditions and parameter placeholders are built up in arrays based on which query filters are present — so the walkthrough pays close attention to exactly how those arrays grow and what SQL results.

- **Line 1**: imports the shared `pool`.
- **Line 3**: `VALID_LEVELS = ["debug", "info", "warn", "error"]` is the canonical allow-list used throughout the file for level validation.
- **Lines 5-11**: `LogEntry` interface — `timestamp`, `level`, `service`, `message` are required strings; `attributes` is an optional flat map of string/number/boolean values (explicitly not allowing nested objects, which is enforced later).
- **Lines 13-16**: `InsertResult` — `accepted` count plus a `rejected` array of `{ index, reason }` describing which input rows failed and why.
- **Lines 18-20**: `ValidationResult` is a discriminated union — either `{ valid: true, row: (string|null)[] }` (the 5-element tuple ready for insertion) or `{ valid: false, reason: string }` — letting callers branch on `.valid` with TypeScript narrowing `row`/`reason` accordingly.

### `validateLogEntry` (lines 22-75)

Per-row validation was pulled out of `insertLogs` into this standalone exported function so it can be unit-tested directly (see `src/services/logsService.test.ts`) without a real database call.

- **Lines 23-25**: rejects anything that isn't a plain object (`null`, arrays, primitives) with `"entry must be an object"` — a check the previous inline version didn't have, since it implicitly assumed every array element was already object-shaped.
- **Lines 27-29**: `timestamp` must be truthy, else `"timestamp is required"`.
- **Lines 31-35**: `new Date(ts)` is parsed; `isNaN(time.getTime())` catches unparseable timestamp strings, rejecting with `"invalid timestamp"`.
- **Lines 37-40**: computes `fiveMinutesFromNow = now + 5*60*1000` using the `now` parameter (defaulted to `Date.now()` but overridable — this is what lets tests pin a fixed "current time" instead of racing the real clock), and rejects any timestamp further in the future than that.
- **Lines 42-44**: `level` must be one of `VALID_LEVELS`; rejection message embeds the offending value: `` `invalid level: '${log.level}'` ``.
- **Lines 46-48**: `service` must be a string and non-blank after `.trim()`.
- **Lines 50-52**: same check for `message`.
- **Lines 54-63**: if `attributes` is present (`!= null`), first rejects outright if it isn't a plain object (`"attributes must be a flat object"` — this now explicitly catches arrays via `Array.isArray`, rather than relying on the per-entry loop below to catch them indirectly), then iterates its entries looking for any non-null object value, rejecting with `` `nested object in attribute '${k}'` `` on the first match.
- **Lines 65-74**: on success, returns `{ valid: true, row: [ts, log.level, log.service, log.message, attributes-or-null] }` — `attributes` is serialized with `JSON.stringify` only if present, otherwise `null` (stored in a `jsonb` column).

### `insertLogs` (lines 77-114)

- **Lines 78-80**: if `logs` isn't an array at all, immediately return `{ accepted: 0, rejected: [{ index: -1, reason: "logs must be an array" }] }` — a single sentinel rejection with index `-1` signaling a structural, not per-row, problem.
- **Lines 82-84**: `rejected` accumulates per-row failures; `validRows` accumulates the tuples that will actually be inserted; `now` is captured once outside the loop so every row in the same batch is judged against the same "future" cutoff.
- **Lines 86-94**: iterates every index of `logs`, delegating each row to `validateLogEntry(log, now)` — on failure, pushes `{ index, reason: result.reason }` and `continue`s; on success, pushes `result.row` onto `validRows`.
- **Lines 96-111**: if there's at least one valid row, builds and runs a bulk insert via `unnest()` instead of a hand-built multi-row `VALUES` list:
  - **Lines 100-104**: transposes `validRows` (an array of row-tuples) into five parallel column arrays — `timestamps`, `levels`, `services`, `messages`, `attributes` — one array per column instead of one placeholder group per row.
  - **Lines 106-110**: the query text is fixed regardless of batch size:
    ```sql
    INSERT INTO logs (timestamp, level, service, message, attributes)
    SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::jsonb[])
    ```
    with `values = [timestamps, levels, services, messages, attributes]` — always exactly 5 bound parameters, each one a whole array, no matter whether the batch has 1 row or 10,000. This replaces the previous approach (a `placeholders` array of `($idx,...)` groups joined into a `VALUES (...), (...), ...` list, with `flatValues` holding `rows.length * 5` individual scalar parameters), which made the query text and parameter count grow linearly with batch size, forcing Postgres to re-parse/re-plan a bigger statement on every call. This rewrite was the single biggest ingestion-throughput win measured in this project (~15,000-17,700 logs/sec vs. the old per-row path).
- **Line 113**: returns `{ accepted: validRows.length, rejected }`.

### `queryLogs` (lines 116-250)

- **Line 117**: destructures `service, level, since, until, q, cursor` out of the raw `query` object (typed `any`, i.e., straight from request query-string parsing).
- **Lines 119-126**: if `level` is present, it's split on commas and every resulting token validated against `VALID_LEVELS`, throwing `` `invalid level: '${lvl}'` `` on the first bad one. Note this validation pass is later effectively repeated when the condition is actually built (lines 161-166) — the level string is split twice.
- **Lines 128-138**: `limit` defaults to 100; if `query.limit` is provided, it's coerced with `Number()` and checked with `Number.isInteger()` (throwing `"limit must be a number"` if it isn't a clean integer — e.g. `"3.5"` or `"abc"` both fail this), then explicitly rejected with `"limit must be between 1 and 1000"` if it's outside `[1, 1000]`. This replaced an earlier version that silently clamped an out-of-range value to 1000 via `Math.min` — a caller asking for `limit=5000` now gets a 400 explaining why, instead of quietly getting 1000 rows back with no indication the request was altered.
- **Lines 140-147**: `offset` defaults to 0; if `query.page` is provided, it must parse to an integer `>= 1` (else throws `"page must be a positive number"`), and `offset = (parsedPage - 1) * limit` — classic 1-indexed page-to-offset conversion.
- **Lines 149-154**: initializes the dynamic-SQL scaffolding: `conditions: string[]`, `values: any[]`, `paramIndex = 1` (Postgres placeholders are 1-indexed), plus `sinceDate`/`untilDate` holders used later for cross-field validation.
- **Lines 155-159**: if `service` given, pushes `` `service = $${paramIndex}` ``, pushes the value, increments `paramIndex`. This "push condition, push value, increment index" triplet is the recurring pattern for the rest of the function.
- **Lines 161-166**: if `level` given, splits it again into an array and pushes `` `level = ANY($${paramIndex}::text[])` `` — using `ANY()` against an array parameter lets one placeholder match a *comma-separated set* of levels (e.g. `?level=warn,error`) in a single equality-style condition, and pushes the whole `levels` array as one bound value (node-postgres serializes JS arrays to Postgres arrays automatically).
- **Lines 168-174**: if `since` given, parses it as a `Date`, throws `"invalid 'since' timestamp"` if `NaN`, else pushes `` `timestamp >= $${paramIndex}` `` with the ISO string.
- **Lines 176-182**: symmetric handling for `until`, pushing `` `timestamp < $${paramIndex}` `` (note: `since` is inclusive, `until` is exclusive).
- **Lines 184-186**: if both `sinceDate` and `untilDate` were set, validates `untilDate > sinceDate`, throwing `"'until' must be after 'since'"` otherwise.
- **Lines 188-192**: if `q` given, pushes `` `message ILIKE $${paramIndex}` `` with the value wrapped as `` `%${q}%` `` — a case-insensitive substring search on the message column.
- **Lines 194-201**: iterates every key in the raw `query` object looking for keys prefixed `"attr."` (e.g. `attr.user_id=42`). For each match, `attrKey = key.slice(5)` strips the prefix, and the condition `` `attributes ->> $${paramIndex} = $${paramIndex + 1}` `` is pushed using the JSONB `->>` (get-as-text) operator; both the attribute *key* and its expected *value* are bound as parameters (`values.push(attrKey, query[key])`), so even though the key name comes straight from the query string, it's never string-interpolated into SQL — avoiding injection despite the dynamic key. `paramIndex` advances by 2 per matched attribute filter, and multiple `attr.*` filters can be supplied simultaneously (each becomes its own `AND`-ed condition).
- **Lines 203-205**: `filterConditions`/`filterValues` are shallow copies of `conditions`/`values` taken *before* cursor pagination is applied — this snapshot is reused later purely for the (now-optional) total-count query, so pagination position never affects the reported `total`.
- **Lines 207-220**: if a `cursor` is supplied, it's base64-decoded and JSON-parsed inside a `try/catch`, with an explicit shape check (`decoded.timestamp` must be a `string`, `decoded.id` must be a `number`) — any parse failure or unexpected shape throws `"invalid cursor"` instead of letting a malformed/tampered cursor reach the query with bad bound parameters or crash `JSON.parse` uncaught. On success, a row-wise (tuple) comparison condition `` `(timestamp, id) < ($${paramIndex}, $${paramIndex + 1})` `` is pushed, with the decoded `timestamp`/`id` bound as parameters — a classic **keyset/seek pagination** predicate matching the query's `ORDER BY timestamp DESC, id DESC`, selecting only rows strictly "after" the last row of the previous page, using `id` as a tiebreaker for equal timestamps.
- **Line 222**: `whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : ""`.
- **Lines 223-225**: builds the final query. If a cursor was given, `OFFSET` is omitted entirely (keyset pagination replaces it): `` `SELECT * FROM logs ${whereClause} ORDER BY timestamp DESC, id DESC LIMIT ${limit}` ``. Otherwise (first-page/offset-based access) it includes `` `... LIMIT ${limit} OFFSET ${offset}` ``. Note `limit` and `offset` are interpolated directly into the SQL text rather than bound as parameters — safe here only because both are guaranteed-numeric values produced internally, never raw strings.
  - Example generated SQL with `service` + `level` filters and a `cursor`:
    ```sql
    SELECT * FROM logs
    WHERE service = $1 AND level = ANY($2::text[]) AND (timestamp, id) < ($3, $4)
    ORDER BY timestamp DESC, id DESC
    LIMIT 100
    ```
    with `values = [service, ['warn','error'], cursorTimestamp, cursorId]`.
- **Line 227**: executes the main query.
- **Lines 229-239**: `total` starts as `null`, and the count query only runs `if (!cursor)` — i.e., only on the dashboard's page-number path, never on the cursor-paginated path the required API contract and the load generator actually exercise. This replaces an earlier version that ran `` `SELECT COUNT(*) FROM logs ${countWhereClause}` `` unconditionally on every call, doubling read cost for a `total` field cursor callers never look at. When it does run, it reuses `filterConditions`/`filterValues` (filters only, no cursor condition), so `total` reflects all matching rows across every page, not just the current one.
- **Lines 241-247**: `nextCursor` is only computed if `result.rows.length === limit` — i.e., the page came back full, implying there might be more rows beyond it (if fewer rows than `limit` were returned, it's the last page and `nextCursor` stays `null`). When set, it takes the *last* row of the current page and base64-encodes `{ timestamp, id }` from it, to be passed back as the next request's `cursor`.
- **Line 249**: returns `{ logs: result.rows, total, next_cursor: nextCursor }` — `total` is `null` whenever a cursor was used.

### `queryAggregate` (lines 251-348)

- **Line 252**: destructures `service, level, since, until, q, bucket, group_by`.
- **Lines 254-256**: `since` and `until` are both mandatory here (unlike `queryLogs`, where they're optional) — throws `"'since' and 'until' are required"` if either is missing.
- **Lines 257-259**: `bucket` is also mandatory, throws `"'bucket' is required"`.
- **Lines 261-267**: `bucketMap` whitelists four short codes to Postgres interval literals: `1m → "1 minute"`, `5m → "5 minutes"`, `1h → "1 hour"`, `1d → "1 day"`. `bucketInterval` is looked up from this map.
- **Lines 268-270**: if `bucket` isn't one of the four keys, `bucketInterval` is `undefined` and the code throws `"bucket must be one of: 1m, 5m, 1h, 1d"`.
- **Lines 272-274**: `group_by`, if provided, must be exactly `"service"` or `"level"`, else throws.
- **Lines 276-280**: parses `since`/`until` as `Date`s, throwing `"invalid 'since' or 'until' timestamp"` if either is `NaN`.
- **Lines 281-283**: validates `untilDate > sinceDate`.
- **Lines 285-287**: if `level` given, it's validated as a *single* value against `VALID_LEVELS` — unlike `queryLogs`, this endpoint does not support comma-separated multi-level filtering for aggregates.
- **Lines 289-291**: unlike `queryLogs`, `since`/`until` are mandatory, so they're seeded directly as the first two conditions/values: `conditions = ["timestamp >= $1", "timestamp < $2"]`, `values = [sinceISO, untilISO]`, and `paramIndex` starts at 3.
- **Lines 293-297**: optional `service` equality filter appended the same "push condition/value/increment" way.
- **Lines 299-303**: optional `level` equality filter (single value, plain `=`, not `ANY()`).
- **Lines 305-309**: optional `q` `ILIKE` substring filter on `message`.
- **Lines 311-318**: same dynamic `attr.*` handling as `queryLogs` — parameterized JSONB `->>` key/value pairs, `paramIndex += 2` per match.
- **Line 320**: `whereClause = conditions.join(" AND ")` — always non-empty since `since`/`until` are mandatory, so no `WHERE`-omission branch is needed here (unlike `queryLogs`).
- **Line 321**: `groupColumn` resolves to `"service"`, `"level"`, or `null` based on `group_by`.
- **Line 323**: `selectGroup` is either `` `${groupColumn} AS group_value` `` or the literal string `"NULL AS group_value"` — ensuring the result set always has a `group_value` column, whether or not grouping was requested, so downstream row mapping (lines 341-345) doesn't need conditional logic.
- **Lines 324-326**: `groupByClause` is `` `GROUP BY bucket_start, ${groupColumn}` `` when grouping, else plain `"GROUP BY bucket_start"`.
- **Lines 328-337**: assembles the final SQL using TimescaleDB's `time_bucket()` function:
  ```sql
  SELECT
    time_bucket('<bucketInterval>', timestamp) AS bucket_start,
    <selectGroup>,
    COUNT(*) AS count
  FROM logs
  WHERE <whereClause>
  <groupByClause>
  ORDER BY bucket_start ASC
  ```
  `bucketInterval` is interpolated directly into the SQL string rather than bound as a parameter, but this is safe because it can only ever be one of the four fixed literals from `bucketMap` — never raw user input.
  - Concrete example for `bucket=1h`, `group_by=service`, with a `service` filter also applied:
    ```sql
    SELECT
      time_bucket('1 hour', timestamp) AS bucket_start,
      service AS group_value,
      COUNT(*) AS count
    FROM logs
    WHERE timestamp >= $1 AND timestamp < $2 AND service = $3
    GROUP BY bucket_start, service
    ORDER BY bucket_start ASC
    ```
- **Line 339**: executes with `values`.
- **Lines 341-345**: maps each row to `{ start: row.bucket_start, group: row.group_value, count: parseInt(row.count, 10) }` — `group` will be `null` when no `group_by` was requested.
- **Line 347**: returns `{ buckets }`.

## src/services/notificationService.ts

This is a small, straightforward CRUD module over a `notifications` table, used to surface system events (alerts firing, retention runs completing) in a dashboard "notifications" panel. It has no business logic beyond basic reads/writes and ordering, and every other service in this batch (`alertService.ts`, `retentionService.ts`) calls into `createNotification` as their only side effect on this table.

- **Lines 3-12**: `Notification` interface mirrors the table's columns: `id`, `type`, `title`, `message`, `service` (nullable), `level` (nullable), `is_read`, `created_at`.
- **Lines 14-25**: `createNotification(type, title, message, service?, level?)` runs a parameterized `INSERT INTO notifications (type, title, message, service, level) VALUES ($1, $2, $3, $4, $5)`, defaulting `service`/`level` to `null` via `service || null` / `level || null` (note: this means an empty-string `service`/`level` would also collapse to `null`, not just `undefined`). It returns nothing (`Promise<void>`) — callers fire-and-forget this.
- **Lines 27-36**: `getNotifications(limit = 50)` selects the named columns `ORDER BY is_read ASC, created_at DESC LIMIT $1` — ordering by `is_read ASC` puts unread notifications (`false`/`0`) before read ones (`true`/`1`) first, and within each of those two groups, `created_at DESC` shows the newest first. So the result is: all unread notifications newest-first, followed by all read notifications newest-first, capped at `limit`.
- **Lines 38-43**: `markAsRead(id)` runs `UPDATE notifications SET is_read = TRUE WHERE id = $1` for a single notification.
- **Lines 45-49**: `markAllAsRead()` runs a bulk `UPDATE notifications SET is_read = TRUE WHERE is_read = FALSE` — no parameters, flips every currently-unread row.
- **Lines 51-56**: `getUnreadCount()` runs `SELECT COUNT(*) as count FROM notifications WHERE is_read = FALSE` and returns the parsed integer, presumably to drive a badge count in the UI.

## src/services/retentionService.ts

This module enforces a data-retention policy on the `logs` table: it periodically drops entire TimescaleDB chunks older than a configurable cutoff — rather than deleting rows in bounded batches — and reports the result via a notification. Like `alertService.ts`, it's scheduled with a plain `setInterval` rather than an external cron/job-queue system.

- **Lines 1-2**: imports `pool` and `createNotification`.
- **Line 3**: `RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || "30", 10)` — reads the retention window (in days) from the `RETENTION_DAYS` environment variable, defaulting to 30 days if unset.
- **Line 6**: `cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)` computes the retention boundary entirely in JavaScript (not via a SQL `NOW() - interval` expression as in `alertService.ts`) — any rows with `timestamp < cutoff` are logically past retention.
- **Lines 8-10**: a comment states the key trade-off up front: `drop_chunks` only removes chunks *entirely* older than `cutoff`, so a chunk straddling the boundary survives intact — actual retention granularity is bounded by one `chunk_time_interval` (7 days by default), not exact-to-the-day.
- **Lines 11-15**: runs `SELECT COUNT(*) FROM logs WHERE timestamp < $1` **first**, purely for reporting — this count is not part of the deletion logic (unlike the previous batch-delete version, where the reported count came directly from the `DELETE`'s `rowCount`). Because of the chunk-boundary trade-off above, this count can slightly overestimate what `drop_chunks` actually removes, since it counts every row past `cutoff` while `drop_chunks` only drops whole chunks past it.
- **Lines 17-19**: `SELECT drop_chunks('logs', older_than => $1::timestamptz)` is the entire deletion step — a single call to TimescaleDB's chunk-management function. This replaces a previous `while (true)` loop of bounded `DELETE FROM logs WHERE (id, timestamp) IN (SELECT id, timestamp FROM logs WHERE timestamp < $1 LIMIT $2)` batches (1,000 rows per iteration, looping until a batch came back smaller than the limit). `drop_chunks` operates at the metadata level — unlinking whole chunk tables the way `DROP TABLE` would — instead of deleting individual rows, so there's no per-row WAL/vacuum churn and no batch loop needed to bound per-statement lock duration.
- **Lines 21-24**: if `totalDeleted > 0` (per the count from lines 11-15), calls `createNotification("retention", "Retention Run Complete", ...)` reporting the count and the configured retention window, and logs the same to the console. If nothing matched, no notification is created (avoids noise on quiet runs).
- **Line 26**: returns `totalDeleted`.
- **Lines 29-34**: `startRetentionJob(intervalMs = 60 * 60 * 1000)` (default 1 hour):
  - **Line 30**: runs `runRetention()` immediately on startup (not waiting for the first interval tick), with `.catch` logging any error.
  - **Lines 32-34**: then schedules `runRetention()` again every `intervalMs` via `setInterval`, each invocation independently wrapped in `.catch(err => console.error("Retention error:", err))` so a failure in one run doesn't stop future scheduled runs or crash the process.

## src/services/supportService.ts

This module implements the AI-powered support-chat feature of the dashboard: it forwards a user's chat message, along with a fixed system prompt *and* a live snapshot of the database, to an LLM via OpenRouter's chat-completions API, and returns the assistant's reply text. Unlike an earlier version of this module, it now does touch the database — via `getDbContext()` below — specifically so the assistant can answer questions about the *actual* current data instead of only giving generic product help.

- **Lines 1-5**: `SYSTEM_PROMPT` frames the assistant's persona ("the AI support assistant for Obsidian Log Engine"), telling it to help with log ingestion (`POST /logs`), querying (`GET /logs`, "ObsidianQL search syntax"), aggregation, and retention policies — and now also explicitly instructs it to "use the database context provided to answer questions about their actual data," since that context is attached to every request (see lines 57, 78 below).
- **Lines 7-49**: `getDbContext()` — gathers a snapshot of the database for the model to reason over, wrapped entirely in a `try/catch`:
  - **Line 9**: dynamically imports `pool` from `../db/index.js` inside the function body (rather than a top-level import), so this module stays loadable without a live DB connection until a chat message actually needs a reply.
  - **Lines 11-19**: one query computes `total_logs`, `services` (distinct count), `levels` (distinct count), and `oldest`/`newest` timestamps across the whole `logs` table.
  - **Lines 21-27**: a second query breaks log counts down by `level` over the last 24 hours (`timestamp > now() - interval '24 hours'`).
  - **Lines 29-36**: a third query does the same grouped by `service`, capped to the top 8 by count.
  - **Lines 38-45**: bundles all three results into one JSON string (`total_logs`, `services_count`, `oldest`, `newest`, `last_24h_by_level`, `last_24h_by_service`) that later gets embedded directly into the prompt sent to the model.
  - **Lines 46-48**: any failure (e.g. DB unreachable) is caught and swallowed, falling back to the literal string `"Database context unavailable"` — a chat reply should never hard-fail just because the context-gathering queries did.
- **Line 51**: `getSupportReply(message: string): Promise<string>` is the sole export.
- **Lines 52-55**: reads `apiKey` from `process.env.OPENAI_API_KEY`, throwing `"OPENAI_API_KEY not configured"` if unset. Despite the env var's name suggesting OpenAI directly, it's used below as the bearer token against **OpenRouter's** API endpoint — a naming mismatch worth flagging for anyone expecting this key to work against `api.openai.com` directly.
- **Line 57**: awaits `getDbContext()` before making the outbound request, so the context string is ready to embed in the prompt.
- **Lines 59-60**: creates an `AbortController` and arms a 15-second `setTimeout` that calls `controller.abort()` — a server-side safety net so a hung upstream OpenRouter request can't leave the Express request handler (and in turn the client's own request, see the frontend's matching 20s timeout) waiting indefinitely.
- **Lines 62-92**: the `fetch` call is wrapped in `try/catch/finally`:
  - **Lines 64-84**: issues `fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", ... })` with headers `Content-Type: application/json`, `Authorization: Bearer <apiKey>`, and OpenRouter's attribution headers `HTTP-Referer`/`X-Title`; the JSON body sets `model: "gpt-4o-mini"`, a two-message `messages` array (`system` = `SYSTEM_PROMPT`, `user` = a combined string embedding both the db context and the question — `` `Current database context: ${dbContext}\n\nUser question: ${message}` `` — so the model sees live data and the question together), `max_tokens: 300`, and `signal: controller.signal` so the timeout above can actually cancel this in-flight request.
  - **Lines 85-89**: if `fetch` itself throws with `error.name === "AbortError"` (i.e., the 15s timeout fired), it's translated into a clearer `"OpenRouter request timed out"` error; any other thrown error is rethrown as-is.
  - **Lines 90-92**: `finally` always clears the timeout, so a request that completes before 15s doesn't leave a stray timer armed.
- **Lines 94-97**: if `!response.ok` (any non-2xx HTTP status), reads the response body as text and throws `` `OpenRouter request failed: ${response.status} ${text}` `` — surfacing the upstream error verbatim to the caller.
- **Lines 99-100**: parses the JSON response body (typed `any` since the shape isn't formally modeled) and returns `data.choices?.[0]?.message?.content?.trim()`, defensively optional-chained in case the response shape is unexpected, falling back to the literal string `"Sorry, I couldn't come up with a response."` if the content path is missing or empty.
