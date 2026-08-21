import { Pool } from "pg";

const connectionConfig = {
  user: "loguser",
  password: "logpass",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5433", 10),
  database: "logdb",
};

export const POOL_MAX = 10;
export const pool = new Pool({ ...connectionConfig, max: POOL_MAX });

export const queryPool = new Pool({ ...connectionConfig, max: 8, statement_timeout: 8000 });

export const rollupPool = new Pool({ ...connectionConfig, max: 2, statement_timeout: 5000 });