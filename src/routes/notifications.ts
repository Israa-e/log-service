import { Router } from "express";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
} from "../services/notificationService.js";

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: List notifications
 *     tags: [Notifications]
 *     responses:
 *       200:
 *         description: All notifications, newest first
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 notifications:
 *                   type: array
 *                   items:
 *                     $ref: "#/components/schemas/Notification"
 *       500:
 *         description: Failed to fetch notifications
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 * /notifications/read-all:
 *   post:
 *     summary: Mark all notifications as read
 *     tags: [Notifications]
 *     responses:
 *       200:
 *         description: All notifications marked as read
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Success"
 *       500:
 *         description: Failed to mark notifications as read
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 * /notifications/{id}/read:
 *   post:
 *     summary: Mark a notification as read
 *     tags: [Notifications]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Notification ID
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Notification marked as read
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Success"
 *       400:
 *         description: Invalid notification ID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 *       500:
 *         description: Failed to mark notification as read
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 */

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const notifications = await getNotifications();
    res.json({ notifications });
  } catch {
    res.status(500).json({ error: "failed to fetch notifications" });
  }
});

router.post("/read-all", async (_req, res) => {
  try {
    await markAllAsRead();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "failed to mark all as read" });
  }
});

router.post("/:id/read", async (req, res) => {
  try {
    const id = parseInt(req.params.id!, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    await markAsRead(id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "failed to mark as read" });
  }
});

export default router;
