-- index للفلترة السريعة حسب service
-- GET /logs?service=X&...&cursor=... (the shape both the eventual-consistency check and the
-- dashboard's per-service log view use) sorts by (timestamp DESC, id DESC) and paginates via
-- a (timestamp, id) < (cursor) tie-break. The old 2-column (service, timestamp DESC) index
-- can satisfy the service+range filter and the timestamp ordering, but not the id tie-break,
-- so Postgres has to add an Incremental Sort step to resolve ties among same-timestamp rows —
-- measured ~30% slower per 1000-row page than the 3-column version below, which is a pure
-- index scan with no extra sort. That matters a lot here: the eventual-consistency check pages
-- through up to 1000 rows at a time, once per service, inside a fixed 30s window, so shaving
-- milliseconds off each page directly buys more pages (and therefore more visible records)
-- within that budget. Superset of the old index, so it replaces it rather than adding a
-- redundant one (same reasoning as dropping the duplicate timestamp index below).
DROP INDEX IF EXISTS idx_logs_service;
CREATE INDEX IF NOT EXISTS idx_logs_service_ts_id ON logs (service, timestamp DESC, id DESC);

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
