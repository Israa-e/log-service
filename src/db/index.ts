import { Pool } from "pg";

export const pool = new Pool({
  user: "loguser",
  password: "logpass",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5433", 10),
  database: "logdb",
});