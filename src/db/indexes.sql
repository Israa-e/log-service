-- index للفلترة السريعة حسب service
CREATE INDEX IF NOT EXISTS idx_logs_service ON logs (service, timestamp DESC);

-- index للفلترة السريعة حسب level
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs (level, timestamp DESC);

-- index لدعم pagination و ORDER BY timestamp DESC, id DESC
CREATE INDEX IF NOT EXISTS idx_logs_timestamp_id_desc ON logs (timestamp DESC, id DESC);

-- create_hypertable() creates this automatically on the time dimension; it's a strict
-- subset of idx_logs_timestamp_id_desc above, so drop it to avoid maintaining two
-- near-identical btree indexes on every insert.
DROP INDEX IF EXISTS logs_timestamp_idx;

-- attr.<key> and q= (message ILIKE) filters are evaluated unindexed, bounded by
-- TimescaleDB chunk exclusion on the since/until range. A GIN index (jsonb_path_ops
-- or pg_trgm) would speed up these optional filters, but GIN maintenance is charged
-- on every write, and Postgres is CPU-constrained (1 core) while sustained ingest
-- throughput is the primary target — so we spend that CPU budget on inserts, not on
-- indexing filters that are rarely the dominant query pattern.