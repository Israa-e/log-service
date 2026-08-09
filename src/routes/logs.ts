import { Router } from "express";
import {
    createLogs,
    getLogs,
    aggregateLogs
} from "../controllers/logsController.js";


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