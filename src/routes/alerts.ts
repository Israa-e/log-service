import { Router } from "express";
import { createAlert, listAlerts } from "../controllers/alertsController.js";

/**
 * @swagger
 * /alerts:
 *   post:
 *     summary: Create an alert rule
 *     description: Creates a rule that fires a webhook notification when the error count in the window meets the threshold.
 *     tags: [Alerts]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/AlertRule"
 *     responses:
 *       201:
 *         description: Alert rule created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/AlertRule"
 *       400:
 *         description: Invalid rule
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 * /alerts/list:
 *   get:
 *     summary: List alert rules
 *     tags: [Alerts]
 *     responses:
 *       200:
 *         description: All alert rules, newest first
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: "#/components/schemas/AlertRule"
 *       500:
 *         $ref: "#/components/responses/InternalError"
 */

const router = Router();

router.post("/", createAlert);
router.get("/list", listAlerts);
export default router;