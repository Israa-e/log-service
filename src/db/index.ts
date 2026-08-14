import { Pool } from "pg";

const connectionConfig = {
  user: "loguser",
  password: "logpass",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5433", 10),
  database: "logdb",
};

// Ingestion is the hot, high-volume path; queries are comparatively rare but latency-
// sensitive (the aggregate endpoint has a sub-second p95 target). Sharing one pool means
// a query has to queue behind whatever batch of concurrent inserts is already holding
// every connection. A separate small pool lets a query grab a connection immediately
// instead of waiting in that line, even while ingestion saturates the write pool.
export const pool = new Pool({ ...connectionConfig, max: 10 });
export const queryPool = new Pool({ ...connectionConfig, max: 4 });

// Rollup flushes must land on a schedule regardless of how busy ingestion is — sharing
// `pool` let them queue behind saturated ingest traffic under load, delaying aggregate
// visibility well past the eventual-consistency window. A dedicated connection keeps
// flushes off that queue.
export const rollupPool = new Pool({ ...connectionConfig, max: 2 });