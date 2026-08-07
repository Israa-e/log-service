import type { Request, Response, NextFunction } from "express";
import { pool } from "../db/index.js";
import { hashPassword, verifyPassword } from "../services/passwordService.js";

const MIN_PASSWORD_LENGTH = 8;

export async function login(req: Request, res: Response) {
  const { username, password } = req.body || {};

  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "username and password are required" });
  }

  const result = await pool.query(
    "SELECT id, username, password_hash FROM users WHERE username = $1",
    [username]
  );
  const user = result.rows[0];

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: "invalid username or password" });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "could not start session" });
    (req.session as any).authenticated = true;
    (req.session as any).userId = user.id;
    (req.session as any).username = user.username;
    res.json({ success: true, username: user.username });
  });
}

export function logout(req: Request, res: Response) {
  req.session.destroy(() => {
    res.json({ success: true });
  });
}

export function checkAuth(req: Request, res: Response, next: NextFunction) {
  if ((req.session as any)?.authenticated) {
    return next();
  }
  res.redirect("/login.html");
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if ((req.session as any)?.authenticated) {
    return next();
  }
  res.status(401).json({ error: "authentication required" });
}

export function sessionStatus(req: Request, res: Response) {
  if ((req.session as any)?.authenticated) {
    res.json({
      authenticated: true,
      username: (req.session as any).username,
      id: (req.session as any).userId,
    });
  } else {
    res.status(401).json({ authenticated: false });
  }
}

export async function listUsers(req: Request, res: Response) {
  const result = await pool.query(
    "SELECT id, username, created_at FROM users ORDER BY id ASC"
  );
  res.json({ users: result.rows });
}

export async function createUser(req: Request, res: Response) {
  const { username, password } = req.body || {};

  if (typeof username !== "string" || username.trim() === "") {
    return res.status(400).json({ error: "username is required" });
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  try {
    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at",
      [username.trim(), passwordHash]
    );
    res.status(201).json({ user: result.rows[0] });
  } catch (error: any) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "username is already taken" });
    }
    throw error;
  }
}
