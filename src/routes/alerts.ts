import { Router } from "express";
import { createAlert, listAlerts } from "../controllers/alertsController.js";

const router = Router();

router.post("/", createAlert);
router.get("/list", listAlerts);
export default router;