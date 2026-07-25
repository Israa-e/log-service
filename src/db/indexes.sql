-- index للفلترة السريعة حسب service
CREATE INDEX IF NOT EXISTS idx_logs_service ON logs (service, timestamp DESC);

-- index للفلترة السريعة حسب level
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs (level, timestamp DESC);

-- index خاص بـ JSONB attributes (GIN index يدعم البحث جوا الـ JSON)
CREATE INDEX IF NOT EXISTS idx_logs_attributes ON logs USING GIN (attributes);