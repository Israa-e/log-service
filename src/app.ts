import express from "express";
import session from "express-session";
import healthRouter from "./routes/health.js";
import logsRouter from "./routes/logs.js";
import { startRetentionJob } from "./services/retentionService.js";
import { startAlertJob } from "./services/alertService.js";
import alertsRouter from "./routes/alerts.js";
import authRouter from "./routes/auth.js";
import { checkAuth } from "./controllers/authController.js";

import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(
    session({
        secret: process.env.SESSION_SECRET || "dev-secret-change-me",
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 24 * 60 * 60 * 1000 },
    })
);

const PUBLIC = path.join(process.cwd(), "public");
const authPage = (file: string) => (req: any, res: any) => {
  res.sendFile(path.join(PUBLIC, file));
};
app.get("/login.html", (req, res) => res.sendFile(path.join(PUBLIC, "login.html")));
app.get("/", (req, res) => res.redirect("/dashboard"));
app.get("/dashboard", checkAuth, authPage("dashboard.html"));
app.get("/logs-explorer", checkAuth, authPage("logs-explorer.html"));
app.get("/analytics", checkAuth, authPage("analytics.html"));
app.get("/ingestion", checkAuth, authPage("ingestion.html"));
app.get("/retention", checkAuth, authPage("retention.html"));
app.use(express.static(PUBLIC));
app.use("/health", healthRouter);
app.use("/logs", logsRouter);
app.use("/alerts", alertsRouter);
app.use("/auth", authRouter);

startRetentionJob();
startAlertJob();
export default app;