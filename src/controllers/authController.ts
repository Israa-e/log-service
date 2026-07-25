import type { Request, Response } from "express";
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "admin123";

export function login(req: Request, res: Response) {
  const { password } = req.body;

  if (password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: "invalid password" });
  }

  (req.session as any).authenticated = true;
  res.json({ success: true });
}

export function logout(req: Request, res: Response) {
  req.session.destroy(() => {
    res.json({ success: true });
  });
}

export function checkAuth(req: Request, res: Response, next: Function) {
  if ((req.session as any)?.authenticated) {
    return next();
  }
  res.status(401).json({ error: "not authenticated" });
}