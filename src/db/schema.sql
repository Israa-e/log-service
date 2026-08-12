CREATE TABLE IF NOT EXISTS logs (
  id SERIAL,
  timestamp TIMESTAMPTZ NOT NULL,
  level TEXT NOT NULL,
  service TEXT NOT NULL,
  message TEXT NOT NULL,
  attributes JSONB,
  PRIMARY KEY (id, timestamp)
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id SERIAL PRIMARY KEY,
  service TEXT,
  threshold INT NOT NULL,
  window_minutes INT NOT NULL,
  webhook_url TEXT NOT NULL,
  last_triggered_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  service TEXT,
  level TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pre-aggregated rollup for GET /logs/aggregate's primary (no attr/q filter) path.
-- Maintained synchronously inside insertLogs() — one delta row per batch per distinct
-- (minute, service, level) it touches, inserted in the same transaction as the raw
-- insert — rather than via a periodically-refreshed materialized view. A background
-- refresh job would compete with ingestion for the same CPU and, under sustained high
-- throughput, can fall arbitrarily far behind (measured: nearly 2 minutes behind after
-- 90s of sustained load), silently making the aggregate endpoint miss recent data.
--
-- This is append-only by design — no unique constraint, no UPDATE. An earlier version
-- used `ON CONFLICT ... DO UPDATE count = count + delta` against a single row per key,
-- which serializes: many concurrent batches almost always touch the same handful of
-- "current minute" counters, so every batch had to wait for the row lock held by
-- whichever batch got there first (measured: throughput collapsed from ~17k to ~120
-- logs/sec under concurrent load). Appending a new delta row per batch never blocks on
-- another transaction, and SUM(count) at query time is correct regardless of how many
-- delta rows exist for a given bucket — row count stays small because it's bounded by
-- (batches * distinct groups per batch), not raw log volume.
CREATE TABLE IF NOT EXISTS logs_rollup_1m (
  bucket_start TIMESTAMPTZ NOT NULL,
  service TEXT NOT NULL,
  level TEXT NOT NULL,
  count BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_rollup_bucket ON logs_rollup_1m (bucket_start);

CREATE EXTENSION IF NOT EXISTS timescaledb;
SELECT create_hypertable('logs', 'timestamp', if_not_exists => TRUE, migrate_data => TRUE);