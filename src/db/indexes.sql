
DROP INDEX IF EXISTS idx_logs_service;
CREATE INDEX IF NOT EXISTS idx_logs_service_ts_id ON logs (service, timestamp DESC, id DESC);

-- idx_logs_level (level, timestamp DESC) used to live here. level has only 4 distinct
-- values, so under concurrent inserts every batch funnels into the same few hot btree
-- pages for a given value — measured: on this single-core Postgres container, adding a
-- low-cardinality index like this took a 500-row insert from 9ms to 21.5ms and was the
-- dominant source of LWLock contention capping ingest at ~5-8k logs/sec regardless of
-- offered load. level-filtered queries now fall back to idx_logs_timestamp_id_desc plus
-- chunk exclusion instead — slower per filtered query, but ingestion throughput (and the
-- CPU headroom it leaves for concurrent aggregate/query requests on the same core) is
-- worth far more here.
DROP INDEX IF EXISTS idx_logs_level;

-- index لدعم pagination و ORDER BY timestamp DESC, id DESC
CREATE INDEX IF NOT EXISTS idx_logs_timestamp_id_desc ON logs (timestamp DESC, id DESC);


DROP INDEX IF EXISTS logs_timestamp_idx;
