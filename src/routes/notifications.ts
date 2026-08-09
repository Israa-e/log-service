import { Router } from "express";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
} from "../services/notificationService.js";

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
