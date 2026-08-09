import { Router } from "express";

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Service liveness check
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is running
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: OK
 */
const router = Router();

router.get("/", (req, res) => {
    res.status(200).send("OK");
});

export default router;