-- index للفلترة السريعة حسب service
CREATE INDEX IF NOT EXISTS idx_logs_service ON logs (service, timestamp DESC);

-- index للفلترة السريعة حسب level
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs (level, timestamp DESC);

-- index لدعم pagination و ORDER BY timestamp DESC, id DESC
CREATE INDEX IF NOT EXISTS idx_logs_timestamp_id_desc ON logs (timestamp DESC, id DESC);

-- attr.<key> filters use JSONB containment on normalized string values.
-- This lets PostgreSQL use a generic GIN index for dynamic attribute equality.
CREATE INDEX IF NOT EXISTS idx_logs_attributes_gin ON logs USING GIN (attributes jsonb_path_ops);

-- trigram GIN index لتسريع البحث بالـ ILIKE '%q%' على message
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_logs_message_trgm ON logs USING GIN (message gin_trgm_ops);