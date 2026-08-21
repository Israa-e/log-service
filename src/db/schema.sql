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


CREATE TABLE IF NOT EXISTS logs_rollup_1m (
  bucket_start TIMESTAMPTZ NOT NULL,
  service TEXT NOT NULL,
  level TEXT NOT NULL,
  count BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_rollup_bucket ON logs_rollup_1m (bucket_start);
CREATE INDEX IF NOT EXISTS idx_logs_rollup_service_bucket ON logs_rollup_1m (service, bucket_start);

CREATE EXTENSION IF NOT EXISTS timescaledb;
SELECT create_hypertable('logs', 'timestamp', if_not_exists => TRUE, migrate_data => TRUE);