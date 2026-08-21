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
export const POOL_MAX = 10;
export const pool = new Pool({ ...connectionConfig, max: POOL_MAX });

// queryPool only has 4 connections. Without a cap, one slow query (e.g. the unindexed
// q=/attr.* raw-scan fallback in queryAggregate, scanning a large table) can hold a
// connection for tens of seconds — with only 4 total, a couple of those stall every other
// read behind them, including cheap rollup-backed aggregate calls, until the client times
// out. A statement_timeout bounds that: a pathological query fails fast and frees its
// connection instead of jamming the whole pool.
export const queryPool = new Pool({ ...connectionConfig, max: 4, statement_timeout: 8000 });

// Rollup flushes must land on a schedule regardless of how busy ingestion is — sharing
// `pool` let them queue behind saturated ingest traffic under load, delaying aggregate
// visibility well past the eventual-consistency window. A dedicated connection keeps
// flushes off that queue. statement_timeout keeps a stuck flush from occupying one of only
// 2 connections indefinitely — it errors out quickly and flushRollup re-queues the batch
// for the next tick instead of leaving it stalled.
export const rollupPool = new Pool({ ...connectionConfig, max: 2, statement_timeout: 5000 });