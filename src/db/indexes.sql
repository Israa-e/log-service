
DROP INDEX IF EXISTS idx_logs_service;
CREATE INDEX IF NOT EXISTS idx_logs_service_ts_id ON logs (service, timestamp DESC, id DESC);

-- index للفلترة السريعة حسب level
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs (level, timestamp DESC);

-- index لدعم pagination و ORDER BY timestamp DESC, id DESC
CREATE INDEX IF NOT EXISTS idx_logs_timestamp_id_desc ON logs (timestamp DESC, id DESC);


DROP INDEX IF EXISTS logs_timestamp_idx;
