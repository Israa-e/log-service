import { pool } from "../db/index.js";

export interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  service: string | null;
  level: string | null;
  is_read: boolean;
  created_at: string;
}

export async function createNotification(
  type: string,
  title: string,
  message: string,
  service?: string,
  level?: string
): Promise<void> {
  await pool.query(
    `INSERT INTO notifications (type, title, message, service, level) VALUES ($1, $2, $3, $4, $5)`,
    [type, title, message, service || null, level || null]
  );
}

export async function getNotifications(limit = 50): Promise<Notification[]> {
  const result = await pool.query(
    `SELECT id, type, title, message, service, level, is_read, created_at
     FROM notifications
     ORDER BY is_read ASC, created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function markAsRead(id: number): Promise<void> {
  await pool.query(
    `UPDATE notifications SET is_read = TRUE WHERE id = $1`,
    [id]
  );
}

export async function markAllAsRead(): Promise<void> {
  await pool.query(
    `UPDATE notifications SET is_read = TRUE WHERE is_read = FALSE`
  );
}

export async function getUnreadCount(): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM notifications WHERE is_read = FALSE`
  );
  return parseInt(result.rows[0]!.count, 10);
}
