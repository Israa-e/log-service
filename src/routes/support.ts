import { Router } from "express";
import { getSupportReply } from "../services/supportService.js";

/**
 * @swagger
 * /support/chat:
 *   post:
 *     summary: Ask the AI support assistant
 *     tags: [Support]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: Assistant reply
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reply:
 *                   type: string
 *       400:
 *         description: Message is required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 *       502:
 *         description: Support agent unavailable
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 */

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
