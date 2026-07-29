-- index للفلترة السريعة حسب service
CREATE INDEX IF NOT EXISTS idx_logs_service ON logs (service, timestamp DESC);

-- index للفلترة السريعة حسب level
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs (level, timestamp DESC);

-- attr.<key> filters use `attributes ->> key = value` (text comparison) so mixed
-- string/number/boolean attribute values compare correctly. A generic GIN index only
-- accelerates the `@>` containment operator, not `->>`, and `->>` can't be indexed
-- generically since the key is dynamic per-request. We rely on TimescaleDB chunk
-- exclusion from the required since/until range to keep these scans bounded instead.
DROP INDEX IF EXISTS idx_logs_attributes;

-- trigram GIN index لتسريع البحث بالـ ILIKE '%q%' على message
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_logs_message_trgm ON logs USING GIN (message gin_trgm_ops);