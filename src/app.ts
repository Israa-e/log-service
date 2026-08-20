import express from "express";
import session from "express-session";
import healthRouter from "./routes/health.js";
import logsRouter from "./routes/logs.js";
import { flushRollup } from "./services/logs/index.js";
import alertsRouter from "./routes/alerts.js";
import notificationsRouter from "./routes/notifications.js";
import authRouter from "./routes/auth.js";
import supportRouter from "./routes/support.js";
import { checkAuth } from "./controllers/authController.js";
import { setupSwagger } from "./swagger.js";

import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "20mb" }));

// Session middleware touches the cookie store on every request it runs on, so it's
// scoped to the dashboard/auth pages instead of applied globally — the ingestion and
// query endpoints are CPU-constrained and never need a session.
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 },
});

const PUBLIC = path.join(process.cwd(), "public");
const authPage = (file: string) => (req: any, res: any) => {
  res.sendFile(path.join(PUBLIC, file));
};
app.get("/login.html", (req, res) => res.sendFile(path.join(PUBLIC, "login.html")));
app.get("/", (req, res) => res.redirect("/logs-explorer"));
app.get("/dashboard", (req, res) => res.redirect("/logs-explorer"));
app.get("/logs-explorer", sessionMiddleware, checkAuth, authPage("logs-explorer.html"));
app.get("/analytics", sessionMiddleware, checkAuth, authPage("analytics.html"));
app.get("/ingestion", sessionMiddleware, checkAuth, authPage("ingestion.html"));
app.get("/retention", sessionMiddleware, checkAuth, authPage("retention.html"));
app.get("/history", sessionMiddleware, checkAuth, authPage("retention.html"));
app.get("/users", sessionMiddleware, checkAuth, authPage("users.html"));
app.get("/docs", (req, res) => res.sendFile(path.join(PUBLIC, "docs.html")));
app.get("/support", (req, res) => res.sendFile(path.join(PUBLIC, "support.html")));
app.use(express.static(PUBLIC));
setupSwagger(app);
app.use("/health", healthRouter);
app.use("/logs", logsRouter);
app.use("/alerts", alertsRouter);
app.use("/auth", sessionMiddleware, authRouter);
app.use("/notifications", notificationsRouter);
app.use("/support", supportRouter);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ error: "malformed JSON" });
  }
  if (err.type === "entity.too.large") {
    return res.status(400).json({ error: "payload too large" });
  }
  next(err);
});

// Flush whatever's accumulated in memory before the process exits, so a container
// stop/restart doesn't lose the last (up to ~1s of) rollup deltas.
process.on("SIGTERM", () => {
  flushRollup().finally(() => process.exit(0));
});

export default app;