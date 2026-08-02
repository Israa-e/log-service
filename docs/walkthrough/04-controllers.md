## src/controllers/alertsController.ts

This file exposes two Express route handlers for managing alert rules: creating a new rule and listing all existing rules. Both handlers are thin wrappers around `alertService.ts` — they do no validation or business logic themselves, delegating that entirely to `createAlertRule` and `listAlertRules`. The file's only job is to translate service results/errors into HTTP responses, and it distinguishes between "bad input" (400) and "unexpected failure" (500) depending on which handler is involved.

**Lines 1-2 — imports**
```ts
import type { Request, Response } from "express";
import { createAlertRule , listAlertRules} from "../services/alertService.js";
```
Pulls in Express's `Request`/`Response` types (type-only import, erased at compile time) and the two service functions this controller delegates to. Note the inconsistent spacing around the comma/braces (`createAlertRule , listAlertRules`) — cosmetic only, no functional effect.

**Line 4 — `export async function createAlert(req: Request, res: Response)`**
Declares and exports an async Express handler for creating an alert rule. Being `async` means any thrown error inside becomes a rejected promise, which is caught by the local `try/catch` (Express does not auto-catch promise rejections in handlers unless wrapped, but here the try/catch is manual so that's fine).

**Lines 5-10 — the try block**
```ts
try {
    const rule = await createAlertRule(req.body);
    res.status(201).json(rule);
  } catch (error: any) {
```
Line 6: passes the raw `req.body` (assumed to be the alert rule payload — e.g., condition, threshold, channel) straight to `createAlertRule` without any pre-validation in the controller; all validation, if any, happens inside the service. Line 7: on success, responds with HTTP 201 Created and the created rule as JSON — 201 signals a new resource was created, matching REST convention for a POST-style creation endpoint.

**Lines 8-10 — error handling**
```ts
} catch (error: any) {
    res.status(400).json({ error: error.message });
  }
```
Any error thrown by `createAlertRule` (e.g., validation failure) is treated as a client error: the handler responds 400 Bad Request and echoes `error.message` back to the caller. This means the service is expected to throw when the input is invalid, and this controller doesn't distinguish that from other kinds of failures (e.g., a database error would also surface as a 400 with the raw message) — a design choice worth noting since it could leak internal error text to API clients.

**Line 13 — `export async function listAlerts(req: Request, res: Response)`**
Declares and exports the handler for `GET`-style listing of alert rules. Takes no query parameters — no filtering/pagination logic is present in this file.

**Lines 14-16 — the try block**
```ts
try {
    const rules = await listAlertRules();
    res.json(rules);
  } catch (error: any) {
```
Line 15 calls `listAlertRules()` with no arguments, meaning the service alone decides how "all rules" are returned (no support for filters in this controller). Line 16: on success, `res.json(rules)` sends the array with the default status 200.

**Lines 17-19 — error handling**
```ts
} catch (error: any) {
    res.status(500).json({ error: "internal server error" });
  }
```
Unlike `createAlert`, failures here are treated as server-side (500 Internal Server Error), and the actual error message is intentionally suppressed — the client only ever sees the generic string `"internal server error"`. This is an inconsistency worth flagging relative to `createAlert`, which does leak `error.message`; the two handlers use different error-disclosure policies for what could be the same underlying failure class (e.g., a database connectivity issue).

---

## src/controllers/authController.ts

This file implements a minimal, single-password session-based authentication scheme for the dashboard: a hardcoded/env-configured shared password gates a boolean `authenticated` flag stored in the Express session (backed by whatever session store/middleware is configured elsewhere in the app, e.g. `express-session`). It exposes four handlers: `login`, `logout`, `checkAuth` (a middleware/guard for protecting routes), and `sessionStatus` (a status-check endpoint for clients, e.g. the dashboard SPA, to determine if they're logged in). There is no user database, username, or role concept here — it's a single shared-secret gate.

**Line 1 — import**
```ts
import type { Request, Response } from "express";
```
Type-only import of Express's request/response types.

**Line 2 — the shared password constant**
```ts
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "admin123";
```
Reads the dashboard password from the `DASHBOARD_PASSWORD` environment variable, falling back to the literal default `"admin123"` if the env var is unset. This fallback means that if the operator forgets to set `DASHBOARD_PASSWORD` in production, the dashboard is protected only by a well-known default password — a notable security footgun, though the value itself is just a fallback default, not a live secret.

**Line 4 — `export function login(req: Request, res: Response)`**
A synchronous (non-async) handler for the login endpoint — there's no `await`ed work, so no try/catch is needed.

**Line 5 — destructure body**
```ts
const { password } = req.body;
```
Pulls `password` out of the JSON request body. No check that `req.body` exists or that `password` is a string — if the body is missing/malformed, `password` is simply `undefined`, which will fail the equality check below rather than throwing.

**Lines 7-9 — password check and 401**
```ts
if (password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: "invalid password" });
  }
```
Uses strict inequality (`!==`) against the shared constant. If the submitted password doesn't match, the handler responds 401 Unauthorized with `{ error: "invalid password" }` and returns immediately (the `return` prevents falling through to the success path). Note this is a plain string comparison, not a constant-time comparison, so it's theoretically subject to timing side-channels, though in practice this is a minor concern for a single shared password.

**Line 11 — marking the session authenticated**
```ts
(req.session as any).authenticated = true;
```
On a successful password match, sets a custom `authenticated` flag to `true` on `req.session`. The cast to `any` is because Express's `session` type (from `express-session`) doesn't know about this custom property by default — no type augmentation was declared, so TypeScript is bypassed here. This mutation is what session middleware will persist (typically serialized to a cookie-referenced store) for subsequent requests.

**Line 12 — success response**
```ts
res.json({ success: true });
```
Responds with default status 200 and a simple success payload once the session has been marked authenticated.

**Line 15 — `export function logout(req: Request, res: Response)`**
Synchronous handler for logging out.

**Lines 16-18 — destroying the session**
```ts
req.session.destroy(() => {
    res.json({ success: true });
  });
```
Calls the session store's `destroy` method, which removes the session data (invalidating `authenticated`) asynchronously via callback. The response is only sent inside the callback, ensuring the client doesn't get `{ success: true }` until destruction has actually completed. Note: the callback's potential error argument is not checked (most `express-session` `destroy` callbacks receive `(err)`), so a failure during destruction would silently still report success to the client.

**Line 21 — `export function checkAuth(req: Request, res: Response, next: Function)`**
A three-argument function signature matching Express middleware convention (`req, res, next`), intended to be mounted in front of protected routes to gate access based on session state. `next` is typed loosely as `Function` rather than Express's `NextFunction` type.

**Lines 22-24 — the authenticated check**
```ts
if ((req.session as any)?.authenticated) {
    return next();
  }
```
Uses optional chaining (`?.`) in case `req.session` itself is undefined, then checks the custom `authenticated` flag set during `login`. If truthy, calls `next()` to pass control to the next middleware/route handler — this is the "let the request through" path. The `return` ensures the redirect below doesn't also execute.

**Line 25 — the unauthenticated fallback**
```ts
res.redirect("/login.html");
```
If not authenticated, redirects the browser (HTTP 302 by default for `res.redirect`) to a static `/login.html` page rather than returning a JSON 401 — this indicates `checkAuth` is designed for browser navigation/page-load protection (e.g., guarding dashboard HTML pages), not for JSON API calls, which is a different pattern from `sessionStatus` below.

**Line 28 — `export function sessionStatus(req: Request, res: Response)`**
A synchronous handler apparently meant for JS clients (e.g., a dashboard SPA) to poll/check their auth state without triggering a redirect.

**Lines 29-33 — status branching**
```ts
if ((req.session as any)?.authenticated) {
    res.json({ authenticated: true });
  } else {
    res.status(401).json({ authenticated: false });
  }
```
If the session is authenticated, responds 200 with `{ authenticated: true }`. Otherwise, explicitly sets HTTP 401 Unauthorized and responds `{ authenticated: false }` — unlike `checkAuth`, this handler returns a machine-readable JSON status rather than redirecting, appropriate for an API/AJAX consumer that wants to react programmatically to being logged out (e.g., show a login modal).

---

## src/controllers/logsController.ts

This file is the HTTP-facing layer for the core log-ingestion and query API, delegating all real work to `logsService.ts` (`insertLogs`, `queryLogs`, `queryAggregate`). It exposes three handlers: `createLogs` for bulk log ingestion, `getLogs` for filtered log retrieval, and `aggregateLogs` for aggregate queries (e.g., counts/metrics over time buckets). Each handler follows the same try/catch shape — call into the service, forward the result as JSON — but each has slightly different validation and status-code behavior, notably `createLogs`'s partial-success handling and the differing error-disclosure policies across handlers.

**Lines 1-2 — imports**
```ts
import type { Request, Response } from "express";
import { insertLogs, queryAggregate, queryLogs } from "../services/logsService.js";
```
Type-only import of Express types, plus the three service functions this controller wraps.

**Line 5 — `export async function createLogs(req: Request, res: Response)`**
Async handler for the bulk log-ingestion endpoint (presumably `POST /logs` based on naming), spanning lines 5-28.

**Line 12 — input shape validation**
```ts
if (!req.body || !Array.isArray(req.body.logs)) {
    return res.status(400).json({ error: "body must contain a 'logs' array" });
}
```
This is the only real validation done directly in the controller layer across all three files. It checks that `req.body` exists at all, and that `req.body.logs` is specifically an array (not just present) — protecting `insertLogs` from being called with a malformed shape. If either check fails, responds 400 Bad Request with a descriptive error message and returns immediately, short-circuiting the rest of the handler.

**Line 16 — delegating to the service**
```ts
const result = await insertLogs(req.body.logs);
```
Passes the validated `logs` array to the service layer, which presumably performs per-record validation/insertion and returns a result object containing at least an `accepted` count (used next) plus likely per-record error details.

**Lines 18-19 — conditional status code based on partial success**
```ts
res.status(result.accepted > 0 ? 200 : 400)
    .json(result);
```
This is the most nuanced status logic in the file: rather than a flat success/failure, it inspects `result.accepted` (presumably the count of logs that were successfully ingested out of a potentially mixed-validity batch). If at least one log was accepted (`> 0`), it responds 200 OK even if some logs in the batch may have failed — treating "partial success" as an overall success. If zero logs were accepted (all rejected), it responds 400 Bad Request. In both cases, the full `result` object (which presumably includes both accepted and rejected details) is returned to the client so it can inspect exactly what happened to each log line.

**Lines 21-27 — top-level error handling**
```ts
} catch (error) {
    res.status(500).json({
        error: "internal server error"
    });
}
```
Note `error` here is untyped (no `: any`), unlike the other two handlers in this file. Any exception thrown by `insertLogs` itself (e.g., a database connection failure, as opposed to a per-record validation issue already handled by `result.accepted`) is treated as an unexpected server-side failure: responds 500 with a generic message, deliberately not exposing `error.message` to the client — this mirrors the disclosure policy of `listAlerts` in `alertsController.ts` (from earlier in this doc) but not the other handlers in this same file, which do leak messages (see below).

**Line 30 — `export async function getLogs(req: Request, res: Response)`**
Async handler for querying/filtering logs (presumably `GET /logs`), spanning lines 30-48.

**Lines 35-40 — delegating and responding**
```ts
try {
    const result = await queryLogs(req.query);
    res.json(result);
```
Line 37: passes `req.query` (the raw Express query-string object, e.g. `{ level: "error", from: "...", to: "..." }`) directly to `queryLogs` with no controller-side validation — all filter parsing/validation is the service's responsibility. Line 39: on success, returns the result as JSON with default status 200.

**Lines 41-46 — error handling**
```ts
} catch (error: any) {
    res.status(400).json({
        error: error.message
    });
}
```
Here `error` is typed `any` (allowing `.message` access), and any thrown error — whatever its actual cause — is treated as a 400 Bad Request, with the raw `error.message` sent back to the client. This assumes `queryLogs` only throws for client-caused issues (e.g., invalid query parameters), since a genuine server/database error would also be reported as 400 here with its message potentially exposed to the caller — a difference in disclosure policy compared to `createLogs`'s 500 path.

**Line 50 — `export async function aggregateLogs(req: Request, res: Response)`**
Async handler for aggregate queries (presumably `GET /logs/aggregate` or similar, for dashboard charts/metrics), spanning lines 50-68. Structurally identical to `getLogs`.

**Lines 55-59 — delegating and responding**
```ts
try {
    const result = await queryAggregate(req.query);
    res.json(result);
```
Line 57 passes `req.query` straight to `queryAggregate` with no controller-side validation, mirroring `getLogs`. Line 59 responds with the result as JSON at default status 200 on success.

**Lines 61-66 — error handling**
```ts
} catch (error: any) {
    res.status(400).json({
        error: error.message
    });
}
```
Identical pattern to `getLogs`: any error thrown by `queryAggregate` (whether from invalid input like a bad time-bucket parameter, or an internal failure) results in a 400 response with the raw `error.message` exposed to the client. As with `getLogs`, this means query-side failures are always presented to the caller as their own fault (400), and the actual error text (which could originate from the database layer) is not sanitized before being sent in the response body.
