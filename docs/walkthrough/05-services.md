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

### `insertLogs` (lines 18-100)

- **Lines 19-21**: if `logs` isn't an array at all, immediately return `{ accepted: 0, rejected: [{ index: -1, reason: "logs must be an array" }] }` — a single sentinel rejection with index `-1` signaling a structural, not per-row, problem.
- **Lines 23-24**: `rejected` accumulates per-row failures; `validRows` accumulates the tuples that will actually be inserted, as arrays of `(string | null)`.
- **Line 26-27**: iterates every index of `logs`; `log = logs[index]!` (non-null assertion since indexing an array within its length is always defined).
- **Lines 29-32**: `timestamp` must be truthy, else rejected with `"timestamp is required"` and `continue` to the next log (skipping all further checks for this row).
- **Lines 34-39**: `new Date(ts)` is parsed; `isNaN(time.getTime())` catches unparseable timestamp strings, rejecting with `"invalid timestamp"`.
- **Lines 41-45**: computes `fiveMinutesFromNow = Date.now() + 5*60*1000` and rejects any timestamp further in the future than that, guarding against clock-skew or bad client data producing logs "from the future."
- **Lines 47-50**: `level` must be one of `VALID_LEVELS`; rejection message embeds the offending value: `` `invalid level: '${log.level}'` ``.
- **Lines 52-55**: `service` must be a string and non-blank after `.trim()`.
- **Lines 57-60**: same check for `message`.
- **Lines 62-72**: if `attributes` is present (`!= null`), the code iterates its entries looking for any value that is a non-null object (`v != null && typeof v === "object"`) — this also rejects arrays, since `typeof [] === "object"` in JS, even though arrays aren't explicitly mentioned as disallowed in the interface comment. On the first nested/object value found, it rejects with `` `nested object in attribute '${k}'` `` and sets `hasNested = true`, breaking the inner loop; `if (hasNested) continue` then skips the rest of processing for this row.
- **Lines 74-80**: for a row that passed every check, pushes a 5-element tuple `[ts, log.level, log.service, log.message, attributes-or-null]` onto `validRows`. `attributes` is serialized with `JSON.stringify` only if present, otherwise `null` (stored presumably in a `jsonb` column).
- **Lines 83-97**: if there's at least one valid row, a bulk multi-row `INSERT` is built manually:
  - **Lines 84-91**: for each row in `validRows`, a placeholder group `($idx, $idx+1, $idx+2, $idx+3, $idx+4)` is pushed onto `placeholders`, and the row's 5 values are pushed flat onto `flatValues`; `idx` advances by 5 each iteration so parameter numbers never collide across rows.
  - **Line 93-96**: the final query is `INSERT INTO logs (timestamp, level, service, message, attributes) VALUES ${placeholders.join(", ")}`. For 2 valid rows this looks like:
    ```sql
    INSERT INTO logs (timestamp, level, service, message, attributes)
    VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)
    ```
    with `flatValues` holding all 10 values in order. This means an arbitrarily large batch produces one single `INSERT` statement with as many parameter placeholders as rows × 5 — no chunking/batching is applied here beyond whatever caller-side batch size is used to invoke `insertLogs`.
- **Line 99**: returns `{ accepted: validRows.length, rejected }`.

### `queryLogs` (lines 102-221)

- **Line 103**: destructures `service, level, since, until, q, cursor` out of the raw `query` object (typed `any`, i.e., straight from request query-string parsing).
- **Lines 105-112**: if `level` is present, it's split on commas and every resulting token validated against `VALID_LEVELS`, throwing `` `invalid level: '${lvl}'` `` on the first bad one. Note this validation pass is later effectively repeated when the condition is actually built (lines 144-149) — the level string is split twice.
- **Lines 114-121**: `limit` defaults to 100; if `query.limit` is provided, it's parsed with `parseInt` (throwing `"limit must be a number"` on `NaN`), then capped with `Math.min(parsedLimit, 1000)` — so callers cannot request more than 1000 rows per page regardless of what they pass.
- **Lines 123-130**: `offset` defaults to 0; if `query.page` is provided, it must parse to an integer `>= 1` (else throws `"page must be a positive number"`), and `offset = (parsedPage - 1) * limit` — classic 1-indexed page-to-offset conversion.
- **Lines 132-136**: initializes the dynamic-SQL scaffolding: `conditions: string[]`, `values: any[]`, `paramIndex = 1` (Postgres placeholders are 1-indexed), plus `sinceDate`/`untilDate` holders used later for cross-field validation.
- **Lines 138-142**: if `service` given, pushes `` `service = $${paramIndex}` ``, pushes the value, increments `paramIndex`. This "push condition, push value, increment index" triplet is the recurring pattern for the rest of the function.
- **Lines 144-149**: if `level` given, splits it again into an array and pushes `` `level = ANY($${paramIndex}::text[])` `` — using `ANY()` against an array parameter lets one placeholder match a *comma-separated set* of levels (e.g. `?level=warn,error`) in a single equality-style condition, and pushes the whole `levels` array as one bound value (node-postgres serializes JS arrays to Postgres arrays automatically).
- **Lines 151-157**: if `since` given, parses it as a `Date`, throws `"invalid 'since' timestamp"` if `NaN`, else pushes `` `timestamp >= $${paramIndex}` `` with the ISO string.
- **Lines 159-165**: symmetric handling for `until`, pushing `` `timestamp < $${paramIndex}` `` (note: `since` is inclusive, `until` is exclusive).
- **Lines 167-169**: if both `sinceDate` and `untilDate` were set, validates `untilDate > sinceDate`, throwing `"'until' must be after 'since'"` otherwise.
- **Lines 171-175**: if `q` given, pushes `` `message ILIKE $${paramIndex}` `` with the value wrapped as `` `%${q}%` `` — a case-insensitive substring search on the message column.
- **Lines 177-184**: iterates every key in the raw `query` object looking for keys prefixed `"attr."` (e.g. `attr.user_id=42`). For each match, `attrKey = key.slice(5)` strips the prefix, and the condition `` `attributes ->> $${paramIndex} = $${paramIndex + 1}` `` is pushed using the JSONB `->>` (get-as-text) operator; both the attribute *key* and its expected *value* are bound as parameters (`values.push(attrKey, query[key])`), so even though the key name comes straight from the query string, it's never string-interpolated into SQL — avoiding injection despite the dynamic key. `paramIndex` advances by 2 per matched attribute filter, and multiple `attr.*` filters can be supplied simultaneously (each becomes its own `AND`-ed condition).
- **Lines 186-188**: `filterConditions`/`filterValues` are shallow copies of `conditions`/`values` taken *before* cursor pagination is applied — this snapshot is reused later purely for the total-count query, so pagination position never affects the reported `total`.
- **Lines 190-195**: if a `cursor` is supplied, it's base64-decoded and JSON-parsed into `{ timestamp, id }`. A row-wise (tuple) comparison condition `` `(timestamp, id) < ($${paramIndex}, $${paramIndex + 1})` `` is pushed, with the decoded `timestamp`/`id` bound as parameters. This is a classic **keyset/seek pagination** predicate matching the query's `ORDER BY timestamp DESC, id DESC` — it selects only rows strictly "after" (in sort order) the last row of the previous page, using `id` as a tiebreaker for equal timestamps.
- **Line 197**: `whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : ""`.
- **Lines 198-200**: builds the final query. If a cursor was given, `OFFSET` is omitted entirely (keyset pagination replaces it): `` `SELECT * FROM logs ${whereClause} ORDER BY timestamp DESC, id DESC LIMIT ${limit}` ``. Otherwise (first-page/offset-based access) it includes `` `... LIMIT ${limit} OFFSET ${offset}` ``. Note `limit` and `offset` are interpolated directly into the SQL text rather than bound as parameters — safe here only because both are guaranteed-numeric values produced internally by `parseInt`/`Math.min` earlier, never raw strings.
  - Example generated SQL with `service` + `level` filters and a `cursor`:
    ```sql
    SELECT * FROM logs
    WHERE service = $1 AND level = ANY($2::text[]) AND (timestamp, id) < ($3, $4)
    ORDER BY timestamp DESC, id DESC
    LIMIT 100
    ```
    with `values = [service, ['warn','error'], cursorTimestamp, cursorId]`.
- **Line 202**: executes the main query.
- **Lines 205-209**: builds a separate count query reusing `filterConditions`/`filterValues` (i.e., filters only, no cursor condition): `` `SELECT COUNT(*) FROM logs ${countWhereClause}` ``, so `total` reflects how many rows match the filters across *all* pages, not just the current page.
- **Line 210**: parses `total` from the string count.
- **Lines 212-218**: `nextCursor` is only computed if `result.rows.length === limit` — i.e., the page came back full, implying there might be more rows beyond it (if fewer rows than `limit` were returned, it's the last page and `nextCursor` stays `null`). When set, it takes the *last* row of the current page and base64-encodes `{ timestamp, id }` from it, to be passed back as the next request's `cursor`.
- **Line 220**: returns `{ logs: result.rows, total, next_cursor: nextCursor }`.

### `queryAggregate` (lines 222-319)

- **Line 223**: destructures `service, level, since, until, q, bucket, group_by`.
- **Lines 225-227**: `since` and `until` are both mandatory here (unlike `queryLogs`, where they're optional) — throws `"'since' and 'until' are required"` if either is missing.
- **Lines 228-230**: `bucket` is also mandatory, throws `"'bucket' is required"`.
- **Lines 232-238**: `bucketMap` whitelists four short codes to Postgres interval literals: `1m → "1 minute"`, `5m → "5 minutes"`, `1h → "1 hour"`, `1d → "1 day"`. `bucketInterval` is looked up from this map.
- **Lines 239-241**: if `bucket` isn't one of the four keys, `bucketInterval` is `undefined` and the code throws `"bucket must be one of: 1m, 5m, 1h, 1d"`.
- **Lines 243-245**: `group_by`, if provided, must be exactly `"service"` or `"level"`, else throws.
- **Lines 247-251**: parses `since`/`until` as `Date`s, throwing `"invalid 'since' or 'until' timestamp"` if either is `NaN`.
- **Lines 252-254**: validates `untilDate > sinceDate`.
- **Lines 256-258**: if `level` given, it's validated as a *single* value against `VALID_LEVELS` — unlike `queryLogs`, this endpoint does not support comma-separated multi-level filtering for aggregates.
- **Lines 260-262**: unlike `queryLogs`, `since`/`until` are mandatory, so they're seeded directly as the first two conditions/values: `conditions = ["timestamp >= $1", "timestamp < $2"]`, `values = [sinceISO, untilISO]`, and `paramIndex` starts at 3.
- **Lines 264-268**: optional `service` equality filter appended the same "push condition/value/increment" way.
- **Lines 270-274**: optional `level` equality filter (single value, plain `=`, not `ANY()`).
- **Lines 276-280**: optional `q` `ILIKE` substring filter on `message`.
- **Lines 282-289**: same dynamic `attr.*` handling as `queryLogs` — parameterized JSONB `->>` key/value pairs, `paramIndex += 2` per match.
- **Line 291**: `whereClause = conditions.join(" AND ")` — always non-empty since `since`/`until` are mandatory, so no `WHERE`-omission branch is needed here (unlike `queryLogs`).
- **Line 292**: `groupColumn` resolves to `"service"`, `"level"`, or `null` based on `group_by`.
- **Line 294**: `selectGroup` is either `` `${groupColumn} AS group_value` `` or the literal string `"NULL AS group_value"` — ensuring the result set always has a `group_value` column, whether or not grouping was requested, so downstream row mapping (line 312-316) doesn't need conditional logic.
- **Lines 295-297**: `groupByClause` is `` `GROUP BY bucket_start, ${groupColumn}` `` when grouping, else plain `"GROUP BY bucket_start"`.
- **Lines 299-308**: assembles the final SQL using TimescaleDB's `time_bucket()` function:
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
- **Line 310**: executes with `values`.
- **Lines 312-316**: maps each row to `{ start: row.bucket_start, group: row.group_value, count: parseInt(row.count, 10) }` — `group` will be `null` when no `group_by` was requested.
- **Line 318**: returns `{ buckets }`.

## src/services/notificationService.ts

This is a small, straightforward CRUD module over a `notifications` table, used to surface system events (alerts firing, retention runs completing) in a dashboard "notifications" panel. It has no business logic beyond basic reads/writes and ordering, and every other service in this batch (`alertService.ts`, `retentionService.ts`) calls into `createNotification` as their only side effect on this table.

- **Lines 3-12**: `Notification` interface mirrors the table's columns: `id`, `type`, `title`, `message`, `service` (nullable), `level` (nullable), `is_read`, `created_at`.
- **Lines 14-25**: `createNotification(type, title, message, service?, level?)` runs a parameterized `INSERT INTO notifications (type, title, message, service, level) VALUES ($1, $2, $3, $4, $5)`, defaulting `service`/`level` to `null` via `service || null` / `level || null` (note: this means an empty-string `service`/`level` would also collapse to `null`, not just `undefined`). It returns nothing (`Promise<void>`) — callers fire-and-forget this.
- **Lines 27-36**: `getNotifications(limit = 50)` selects the named columns `ORDER BY is_read ASC, created_at DESC LIMIT $1` — ordering by `is_read ASC` puts unread notifications (`false`/`0`) before read ones (`true`/`1`) first, and within each of those two groups, `created_at DESC` shows the newest first. So the result is: all unread notifications newest-first, followed by all read notifications newest-first, capped at `limit`.
- **Lines 38-43**: `markAsRead(id)` runs `UPDATE notifications SET is_read = TRUE WHERE id = $1` for a single notification.
- **Lines 45-49**: `markAllAsRead()` runs a bulk `UPDATE notifications SET is_read = TRUE WHERE is_read = FALSE` — no parameters, flips every currently-unread row.
- **Lines 51-56**: `getUnreadCount()` runs `SELECT COUNT(*) as count FROM notifications WHERE is_read = FALSE` and returns the parsed integer, presumably to drive a badge count in the UI.

## src/services/retentionService.ts

This module enforces a data-retention policy on the `logs` table: it periodically deletes log rows older than a configurable cutoff, doing so in bounded batches rather than one giant `DELETE`, and reports the result via a notification. Like `alertService.ts`, it's scheduled with a plain `setInterval` rather than an external cron/job-queue system.

- **Lines 1-2**: imports `pool` and `createNotification`.
- **Line 3**: `RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || "30", 10)` — reads the retention window (in days) from the `RETENTION_DAYS` environment variable, defaulting to 30 days if unset.
- **Line 4**: `BATCH_SIZE = 1000` — the maximum number of rows deleted per batch iteration.
- **Line 6**: `cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)` computes the retention boundary entirely in JavaScript (not via a SQL `NOW() - interval` expression as in `alertService.ts`) — any rows with `timestamp < cutoff` are eligible for deletion.
- **Line 7**: `totalDeleted = 0` accumulator.
- **Lines 8-21**: a `while (true)` loop performs batched deletion:
  - **Lines 9-16**: each iteration runs:
    ```sql
    DELETE FROM logs
    WHERE (id, timestamp) IN (
      SELECT id, timestamp FROM logs
      WHERE timestamp < $1
      LIMIT $2
    )
    ```
    with `values = [cutoff.toISOString(), BATCH_SIZE]`. The inner `SELECT` picks up to `BATCH_SIZE` old rows (matching on the composite `(id, timestamp)` key, likely because the target table is a TimescaleDB hypertable partitioned/indexed by `timestamp`, so including `timestamp` in the `WHERE`/join lets Postgres/Timescale prune irrelevant chunks even though `id` alone would suffice for uniqueness), and the outer `DELETE` removes exactly those rows. Deleting via a bounded subquery like this — rather than `DELETE FROM logs WHERE timestamp < $1` directly — caps how much work/locking happens per statement.
  - **Line 17**: `deletedCount = result.rowCount || 0` (the `|| 0` guards against `rowCount` being `null`); this line is formatted oddly, sharing a line with the closing of the previous `pool.query(...)` call, but is functionally just the row-count extraction.
  - **Line 18**: `totalDeleted += deletedCount`.
  - **Line 20**: `if (deletedCount < BATCH_SIZE) break;` — the loop only continues if a full batch was deleted (implying more old rows may remain); once a batch comes back smaller than `BATCH_SIZE`, that means all rows older than the cutoff have been exhausted, so the loop exits. (Per the Arabic comment: "we're done, nothing older than the cutoff remains.") Each iteration is its own statement/round-trip — there's no single wrapping transaction spanning the whole loop, so partial progress is durable even if a later batch fails.
- **Lines 23-26**: if any rows were deleted at all (`totalDeleted > 0`), calls `createNotification("retention", "Retention Run Complete", ...)` with a message reporting how many logs were deleted and the configured retention window, and logs the same to the console. If nothing was deleted, no notification is created (avoids noise on quiet runs).
- **Line 28**: returns `totalDeleted`.
- **Lines 32-37**: `startRetentionJob(intervalMs = 60 * 60 * 1000)` (default 1 hour):
  - **Line 33**: runs `runRetention()` immediately on startup (not waiting for the first interval tick), with `.catch` logging any error.
  - **Lines 35-37**: then schedules `runRetention()` again every `intervalMs` via `setInterval`, each invocation independently wrapped in `.catch(err => console.error("Retention error:", err))` so a failure in one run doesn't stop future scheduled runs or crash the process.

## src/services/supportService.ts

This module implements the AI-powered support-chat feature of the dashboard: it forwards a user's chat message, along with a fixed system prompt describing the product, to an LLM via OpenRouter's chat-completions API, and returns the assistant's reply text. It has no database interaction — it's a pure external-API integration.

- **Lines 1-4**: `SYSTEM_PROMPT` is a fixed string that frames the assistant's persona ("the AI support assistant for Obsidian Log Engine"), telling it to help with log ingestion (`POST /logs`), querying (`GET /logs`, "ObsidianQL search syntax"), aggregation, and retention policies, and to "keep answers short and practical." This is sent as the `system` message on every request — there's no per-user customization or conversation history beyond the single incoming `message`.
- **Line 6**: `getSupportReply(message: string): Promise<string>` is the sole export.
- **Lines 7-10**: reads `apiKey` from `process.env.OPENAI_API_KEY`, throwing `"OPENAI_API_KEY not configured"` if unset. Notably, despite the env var's name suggesting OpenAI directly, it's used below as the bearer token against **OpenRouter's** API endpoint — a naming mismatch worth flagging for anyone expecting this key to work against `api.openai.com` directly.
- **Lines 12-28**: issues `fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", ... })`:
  - **Headers** (lines 14-19): `Content-Type: application/json`, `Authorization: Bearer <apiKey>`, plus OpenRouter-specific attribution headers `HTTP-Referer` (set to the project's GitHub URL) and `X-Title` ("Obsidian Log Engine") — these are OpenRouter conventions for identifying the calling app in their dashboards/rankings, not required by the OpenAI API itself.
  - **Body** (lines 20-27): JSON payload with `model: "gpt-4o-mini"`, a two-message `messages` array (`system` = `SYSTEM_PROMPT`, `user` = the incoming `message`), and `max_tokens: 300` capping the reply length.
- **Lines 30-33**: if `!response.ok` (any non-2xx HTTP status), reads the response body as text and throws `` `OpenRouter request failed: ${response.status} ${text}` `` — surfacing the upstream error verbatim to the caller.
- **Line 35**: parses the JSON response body (typed `any` since the shape isn't formally modeled).
- **Line 36**: returns `data.choices?.[0]?.message?.content?.trim()`, defensively optional-chained in case the response shape is unexpected, falling back to the literal string `"Sorry, I couldn't come up with a response."` if the content path is missing or empty.
