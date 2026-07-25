import type { Request, Response } from "express";
import { createAlertRule , listAlertRules} from "../services/alertService.js";

export async function createAlert(req: Request, res: Response) {
try {
    const rule = await createAlertRule(req.body);
    res.status(201).json(rule);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
}

export async function listAlerts(req: Request, res: Response) {
  try {
    const rules = await listAlertRules();
    res.json(rules);
  } catch (error: any) {
    res.status(500).json({ error: "internal server error" });
  }
}