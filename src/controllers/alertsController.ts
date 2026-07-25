import type { Request, Response } from "express";
import { createAlertRule } from "../services/alertService.js";

export async function createAlert(req: Request, res: Response) {
try {
    const rule = await createAlertRule(req.body);
    res.status(201).json(rule);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
}