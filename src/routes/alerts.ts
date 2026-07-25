import { Router } from "express";
import { createAlert } from "../controllers/alertsController.js";

const router = Router();

router.post("/", createAlert);

export default router;