import express from "express";
import healthRouter from "./routes/health.js";
import logsRouter from "./routes/logs.js";

const app = express();
app.use(express.json());
app.use("/health", healthRouter);
app.use("/logs", logsRouter);

export default app;