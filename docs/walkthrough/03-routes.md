## src/routes/alerts.ts

This file defines the Express router for the `/alerts` HTTP surface (the mount path is set wherever this router is `app.use()`'d, elsewhere in the app). It exposes two endpoints — creating an alert rule and listing existing alert rules — and delegates all business logic to `alertsController.ts`, which in turn talks to `alertService.ts`. The router itself contains no inline logic; it is purely wiring.

- **Line 1**: `import { Router } from "express";` — pulls in Express's `Router` factory, used to build a self-contained, mountable set of routes separate from the main `app` object.
- **Line 2**: `import { createAlert, listAlerts } from "../controllers/alertsController.js";` — imports the two handler functions that contain the actual request/response logic for this resource. Note the `.js` extension on a TypeScript import path — this is required because the project compiles with ESM-style module resolution (Node needs the extension the compiled `.js` file will have).
- **Line 4**: `const router = Router();` — instantiates a new router instance that this module will configure and export.
- **Line 6**: `router.post("/", createAlert);` — registers a `POST /` route (relative to wherever this router is mounted, e.g. `/alerts`) that hands the request straight to `createAlert`. A POST here represents "create a new alert rule."
- **Line 7**: `router.get("/list", listAlerts);` — registers a `GET /list` route that hands off to `listAlerts`. Note this is `/list` rather than a bare `GET /`, so listing alert rules lives at a distinct sub-path instead of overloading the root route with both create and read semantics.
- **Line 8**: `export default router;` — exports the configured router so the parent app (likely `src/app.ts` or `src/index.ts`) can mount it under a base path.

For reference, `createAlert` (in `alertsController.ts`) calls `createAlertRule(req.body)` inside a try/catch, responding `201` with the created rule on success or `400` with `error.message` on failure (validation errors surface directly to the client). `listAlerts` calls `listAlertRules()` and responds with the array as JSON on success, or a generic `500 internal server error` on failure (the underlying error message is swallowed rather than leaked to the client) — this asymmetry between the two handlers' error handling is a detail worth noting for anyone debugging alert-rule creation vs. listing failures.

## src/routes/auth.ts

This file defines the `/auth`-style HTTP surface for the dashboard's session-based authentication: logging in, logging out, and checking session status. All three routes delegate to `authController.ts`, which manages a single shared "authenticated" flag on the Express session rather than per-user credentials. This file is listed as locally modified in git status, so its current on-disk content (read directly below) reflects the working tree, not necessarily the last commit.

- **Line 1**: `import { Router } from "express";` — same Express router factory as in `alerts.ts`.
- **Line 2**: `import { login, logout, sessionStatus } from "../controllers/authController.js";` — imports the three handlers backing this router. Note that `checkAuth` (also exported by `authController.ts` as session-guard middleware) is not imported here — it must be wired up elsewhere (e.g. directly on protected routes or the app), not inside this router.
- **Line 4**: `const router = Router();` — creates the router instance for this module.
- **Line 6**: `router.post("/login", login);` — registers `POST /login`, forwarding to the `login` handler. POST is appropriate since logging in mutates session state.
- **Line 7**: `router.post("/logout", logout);` — registers `POST /logout`, forwarding to `logout`, which also mutates (destroys) session state.
- **Line 8**: `router.get("/session", sessionStatus);` — registers `GET /session`, a read-only check of whether the current session is authenticated, so it correctly uses GET rather than POST.
- **Line 10**: `export default router;` — exports the router for mounting by the parent app.

Behavior of the delegated handlers, for context: `login` (authController.ts lines 4-13) reads `password` from `req.body`, compares it against a single shared `DASHBOARD_PASSWORD` (from the `DASHBOARD_PASSWORD` env var, with a hardcoded fallback default), and either responds `401 invalid password` or sets `req.session.authenticated = true` and responds `{ success: true }`. There is no username/user table — authentication is a single shared dashboard password. `logout` calls `req.session.destroy()` and responds with `{ success: true }` once the session store confirms destruction. `sessionStatus` responds `{ authenticated: true }` if the session's `authenticated` flag is truthy, otherwise `401 { authenticated: false }`.

## src/routes/health.ts

This file implements a minimal liveness/health-check endpoint, typically used by load balancers, container orchestrators, or uptime monitors to verify the process is up and responding. Unlike the other route files, it defines its handler inline rather than delegating to a controller, since the logic is trivial (no service calls, no request parsing).

- **Line 1**: `import { Router } from "express";` — imports the router factory.
- **Line 3**: `const router = Router();` — creates the router instance.
- **Line 5**: `router.get("/", (req, res) => {` — registers a `GET /` route (relative to the mount path, e.g. `/health`) with an inline arrow-function handler. Neither `req` nor any async work is needed, so the handler is synchronous and the parameters are unused beyond satisfying the Express handler signature.
- **Line 6**: `res.status(200).send("OK");` — the entire handler body: explicitly sets the HTTP status to `200` (even though 200 is Express's default, this makes the intent explicit and self-documenting) and sends the plain-text body `"OK"`. There is no JSON envelope here, unlike most other routes in this codebase — this endpoint is meant to be checked by simple tools that just care about a 2xx response and/or a recognizable string, not by API consumers parsing JSON.
- **Line 7**: `});` — closes the route handler.
- **Line 9**: `export default router;` — exports the router for mounting (presumably under `/health`).

## src/routes/logs.ts

This is the core ingestion/query surface of the log service: it exposes endpoints to write batches of logs, read them back with filters, run aggregations, and manually trigger the retention (deletion) job. Three of the four routes delegate to `logsController.ts` (backed by `logsService.ts`), while the retention route is implemented inline with a dynamic import of `retentionService.ts`.

- **Line 1**: `import { Router } from "express";` — the router factory.
- **Lines 2-6**: 
  ```
  import {
      createLogs,
      getLogs,
      aggregateLogs
  } from "../controllers/logsController.js";
  ```
  Imports the three controller functions used later in the file: `createLogs` (ingest), `getLogs` (query), and `aggregateLogs` (aggregate/rollup queries).
- **Line 9**: `const router = Router();` — creates the router instance for this module.
- **Line 11**: `router.post("/retention/run", async (req, res) => {` — registers `POST /retention/run` with an inline async handler, used to manually kick off log retention/deletion outside of its normal scheduled interval (see `startRetentionJob` in `retentionService.ts`). `req` is unused inside the body; only `res` is used to send the response.
- **Line 12**: `const { runRetention } = await import("../services/retentionService.js");` — a *dynamic* `import()` inside the handler rather than a static top-level import. This lazily loads `retentionService.js` the first time the route is hit (Node caches the module after that), which avoids pulling that module's top-level side effects (if any) into the process at startup and keeps this rarely-used admin action's dependency out of the router's static import graph.
- **Line 13**: `const deleted = await runRetention();` — invokes the retention job, which (per `retentionService.ts`) deletes logs past their retention window and resolves with some representation of what was deleted; the result is captured in `deleted`.
- **Line 14**: `res.json({ deleted });` — responds with a JSON object reporting how many/which rows were deleted. Note there is no try/catch here — if `runRetention()` throws, the error propagates to Express's default error handler (typically resulting in a generic 500), unlike the more defensive error handling seen in `notifications.ts` and `support.ts`.
- **Line 15**: `});` — closes the retention-run handler.
- **Line 16**: `router.post("/", createLogs);` — registers `POST /` (e.g. `POST /logs`) for log ingestion, delegating to `createLogs`. Per `logsController.ts`, this validates that `req.body.logs` is an array (400 if not), calls `insertLogs`, and responds `200` or `400` depending on whether any logs were `accepted`.
- **Line 18**: `router.get("/aggregate", aggregateLogs);` — registers `GET /aggregate` for rollup/aggregate queries (e.g. counts bucketed by time or level), delegating to `aggregateLogs`, which forwards `req.query` to `queryAggregate` and returns `400` with the error message on failure.
- **Line 20**: `router.get("/", getLogs);` — registers `GET /` for querying raw logs, delegating to `getLogs`, which forwards `req.query` to `queryLogs` and likewise returns `400` with the error message on failure. This is declared after `/aggregate` so that Express's most-specific-first route ordering doesn't accidentally shadow `/aggregate` (had `GET /` been registered as a catch-all pattern instead of an exact path, ordering would matter more; here the exact-path routes don't actually conflict, but the ordering keeps aggregate and plain-query concerns visually grouped).
- **Line 23**: `export default router;` — exports the router for mounting (presumably under `/logs`).

## src/routes/notifications.ts

This file exposes the in-app/dashboard notifications surface: listing notifications, marking all as read, and marking a single notification as read by id. Unlike `alerts.ts` and `auth.ts`, there is no separate controller layer here — each route handler is defined inline in the router file and calls directly into `notificationService.ts`, with explicit try/catch error handling in every handler.

- **Line 1**: `import { Router } from "express";` — the router factory.
- **Lines 2-6**:
  ```
  import {
    getNotifications,
    markAsRead,
    markAllAsRead,
  } from "../services/notificationService.js";
  ```
  Imports three service functions directly (skipping a controller layer): `getNotifications` (fetch), `markAsRead` (mark one by id), `markAllAsRead` (bulk mark).
- **Line 8**: `const router = Router();` — creates the router instance.
- **Line 10**: `router.get("/", async (_req, res) => {` — registers `GET /` with an inline async handler. The request parameter is named `_req` (leading underscore) to signal it is intentionally unused, since this endpoint takes no query/body input.
- **Lines 11-16** (handler body):
  - **Line 11**: `try {` — opens a try block wrapping the async service call so failures don't crash the process or leave the request hanging.
  - **Line 12**: `const notifications = await getNotifications();` — calls the service to fetch notifications (default limit of 50, per the service's default parameter).
  - **Line 13**: `res.json({ notifications });` — responds with the notifications wrapped in an object under the `notifications` key.
  - **Line 14**: `} catch {` — catches any error from the `try` block; the error itself is discarded (no binding), so callers don't get a hint about the underlying cause, and nothing is logged either.
  - **Line 15**: `res.status(500).json({ error: "failed to fetch notifications" });` — responds with a generic 500 and a fixed error message.
  - **Line 16**: `}` — closes the catch block.
- **Line 17**: `});` — closes the `GET /` handler.
- **Line 19**: `router.post("/read-all", async (_req, res) => {` — registers `POST /read-all` with an inline async handler; again `_req` is unused since there's no input to read.
- **Lines 20-25** (handler body):
  - **Line 20**: `try {` — opens the try block.
  - **Line 21**: `await markAllAsRead();` — calls the service to mark every notification as read; the return value (if any) is discarded.
  - **Line 22**: `res.json({ success: true });` — responds with a simple success flag.
  - **Line 23**: `} catch {` — swallows any error, again without logging or exposing details.
  - **Line 24**: `res.status(500).json({ error: "failed to mark all as read" });` — generic 500 response.
  - **Line 25**: `}` — closes the catch block.
- **Line 26**: `});` — closes the `POST /read-all` handler.
- **Line 28**: `router.post("/:id/read", async (req, res) => {` — registers `POST /:id/read` with a route parameter `:id`; here `req` is used (unlike the previous two handlers) because the id must be read from the URL.
- **Lines 29-39** (handler body):
  - **Line 29**: `try {` — opens the try block.
  - **Line 30**: `const id = parseInt(req.params.id!, 10);` — parses the `:id` route param as a base-10 integer. The non-null assertion (`!`) tells TypeScript that `req.params.id` is definitely defined, which is true given Express only invokes this handler when the `:id` segment is present in the matched path.
  - **Line 31**: `if (isNaN(id)) {` — guards against a non-numeric id (e.g. `/abc/read`), since `parseInt` on non-numeric input yields `NaN`.
  - **Line 32**: `res.status(400).json({ error: "invalid id" });` — responds `400` for a malformed id.
  - **Line 33**: `return;` — returns early from the handler so the `try` block doesn't continue on to call the service with an invalid id.
  - **Line 34**: `}` — closes the `isNaN` guard.
  - **Line 35**: `await markAsRead(id);` — calls the service to mark the specific notification (by numeric id) as read.
  - **Line 36**: `res.json({ success: true });` — responds with a success flag on completion.
  - **Line 37**: `} catch {` — catches any error from parsing (unreachable after the guard) or from the service call, again discarding the error details.
  - **Line 38**: `res.status(500).json({ error: "failed to mark as read" });` — generic 500 response.
  - **Line 39**: `}` — closes the catch block.
- **Line 40**: `});` — closes the `POST /:id/read` handler.
- **Line 42**: `export default router;` — exports the router for mounting (presumably under `/notifications`).
- **Line 43**: trailing blank line at end of file.

## src/routes/support.ts

This file exposes a single endpoint backing the dashboard's support chat feature, accepting a user message and forwarding it to `supportService.ts` (which, based on its function name `getSupportReply`, generates a reply — likely via an external/AI-backed service, though that implementation detail lives outside this file). The handler is defined inline, with input validation before the service call and explicit error handling around it.

- **Line 1**: `import { Router } from "express";` — the router factory.
- **Line 2**: `import { getSupportReply } from "../services/supportService.js";` — imports the single service function this route depends on, which turns a user message string into a reply string.
- **Line 4**: `const router = Router();` — creates the router instance.
- **Line 6**: `router.post("/chat", async (req, res) => {` — registers `POST /chat` (e.g. `POST /support/chat`) with an inline async handler. POST is used because the client sends a message body.
- **Line 7**: `const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";` — defensively extracts `message` from the request body: the optional-chaining (`?.`) guards against `req.body` itself being undefined/null, the `typeof` check ensures the field is actually a string (rejecting numbers, objects, arrays, etc.), and `.trim()` strips leading/trailing whitespace; if any of these conditions fail, `message` falls back to an empty string.
- **Line 8**: `if (!message) {` — checks whether `message` is falsy, i.e. empty (which covers both "missing" and "was only whitespace" cases, since `.trim()` would have already reduced whitespace-only input to `""`).
- **Line 9**: `res.status(400).json({ error: "message is required" });` — responds `400` when no usable message was supplied.
- **Line 10**: `return;` — exits the handler early so the code below doesn't attempt to call the support service with an empty message.
- **Line 11**: `}` — closes the validation guard.
- **Line 12**: `try {` — opens a try block around the actual service call, since it's async and may fail (e.g. if it calls an external API).
- **Line 13**: `const reply = await getSupportReply(message);` — calls the support service with the sanitized message and awaits its reply string.
- **Line 14**: `res.json({ reply });` — responds with the reply wrapped in a `reply` key.
- **Line 15**: `} catch (error: any) {` — catches any failure from the service call; unlike `notifications.ts`, the error is bound to a variable (typed `any`) so it can be inspected.
- **Line 16**: `console.error("Support chat error:", error.message);` — logs the error's message to the server console for debugging/observability, distinguishing this handler from the notifications routes which silently swallow errors.
- **Line 17**: `res.status(502).json({ error: "support agent unavailable" });` — responds with `502 Bad Gateway` rather than a generic `500`, signaling to the client that the failure is specifically attributable to the upstream support agent/service being unreachable or failing, not to this server itself.
- **Line 18**: `}` — closes the catch block.
- **Line 19**: `});` — closes the `POST /chat` handler.
- **Line 21**: `export default router;` — exports the router for mounting (presumably under `/support`).
- **Line 22**: trailing blank line at end of file.
