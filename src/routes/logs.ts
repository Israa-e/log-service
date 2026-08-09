import { Router } from "express";
import {
    createLogs,
    getLogs,
    aggregateLogs
} from "../controllers/logsController.js";


/**
 * @swagger
 * /logs:
 *   post:
 *     summary: Ingest a batch of log entries
 *     description: Accepts a batch of log entries. Valid entries are stored; invalid ones are reported per entry.
 *     tags: [Logs]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/LogBatch"
 *     responses:
 *       200:
 *         description: At least one entry was accepted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/InsertResult"
 *       400:
 *         description: Invalid request body or no entries were valid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 *   get:
 *     summary: Query logs
 *     description: Fetch logs filtered by time range, service, level and full-text search, with offset/page or cursor pagination.
 *     tags: [Logs]
 *     parameters:
 *       - name: service
 *         in: query
 *         description: Exact service name to filter by
 *         schema:
 *           type: string
 *       - name: level
 *         in: query
 *         description: Comma-separated list of levels (debug, info, warn, error)
 *         schema:
 *           type: string
 *       - name: since
 *         in: query
 *         description: Only logs at or after this timestamp
 *         schema:
 *           type: string
 *           format: date-time
 *       - name: until
 *         in: query
 *         description: Only logs at or before this timestamp
 *         schema:
 *           type: string
 *           format: date-time
 *       - name: q
 *         in: query
 *         description: Full-text search over messages
 *         schema:
 *           type: string
 *       - name: limit
 *         in: query
 *         description: Maximum number of rows to return (default 100)
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1000
 *           default: 100
 *       - name: page
 *         in: query
 *         description: 1-based page number (offset pagination)
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - name: cursor
 *         in: query
 *         description: Opaque base64 cursor from the previous response (cursor pagination)
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Matching logs
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/LogQueryResult"
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 * /logs/retention/run:
 *   post:
 *     summary: Run the retention policy
 *     description: Deletes log entries older than the configured retention period.
 *     tags: [Logs]
 *     responses:
 *       200:
 *         description: Retention run completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deleted:
 *                   type: integer
 *                   description: Number of log rows deleted
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 * /logs/aggregate:
 *   get:
 *     summary: Aggregate logs into time buckets
 *     description: Returns log counts bucketed by time, optionally grouped by service or level.
 *     tags: [Logs]
 *     parameters:
 *       - name: since
 *         in: query
 *         required: true
 *         description: Bucket window start
 *         schema:
 *           type: string
 *           format: date-time
 *       - name: until
 *         in: query
 *         required: true
 *         description: Bucket window end
 *         schema:
 *           type: string
 *           format: date-time
 *       - name: bucket
 *         in: query
 *         required: true
 *         description: Bucket interval
 *         schema:
 *           type: string
 *           enum: [1m, 5m, 1h, 1d]
 *       - name: group_by
 *         in: query
 *         description: Split buckets by a field
 *         schema:
 *           type: string
 *           enum: [service, level]
 *       - name: q
 *         in: query
 *         description: Full-text search over messages
 *         schema:
 *           type: string
 *       - name: service
 *         in: query
 *         description: Exact service name to filter by
 *         schema:
 *           type: string
 *       - name: level
 *         in: query
 *         description: Comma-separated list of levels (debug, info, warn, error)
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Aggregated buckets
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/AggregateResult"
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 */

const router = Router();

router.post("/retention/run", async (req, res) => {
  const { runRetention } = await import("../services/retentionService.js");
  const deleted = await runRetention();
  res.json({ deleted });
});
router.post("/", createLogs);

router.get("/aggregate", aggregateLogs);

router.get("/", getLogs);


export default router;