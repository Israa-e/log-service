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
app.get("/index.html", checkAuth, (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});
app.use(express.static(path.join(process.cwd(), "public")));
app.use("/health", healthRouter);
app.use("/logs", logsRouter);
app.use("/alerts", alertsRouter);
app.use("/auth", authRouter);

startRetentionJob();
startAlertJob();
export default app;