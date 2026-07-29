import { Router } from "express";
import { getSupportReply } from "../services/supportService.js";

const router = Router();

router.post("/chat", async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  try {
    const reply = await getSupportReply(message);
    res.json({ reply });
  } catch (error: any) {
    console.error("Support chat error:", error.message);
    res.status(502).json({ error: "support agent unavailable" });
  }
});

export default router;
