# تحضير المناقشة — سؤال وجواب

## إزاي تفتحي الكود بسرعة قبل المناقشة

```bash
# الملفات اللي بتضمن إنك تتذكرها:
src/services/logsService.ts      # قلب المشروع
src/controllers/logsController.ts # API handlers
src/app.ts                        # Setup
src/db/schema.sql                 # Database schema
src/db/indexes.sql                # Indexes
src/services/retentionService.ts  # Retention
src/services/alertService.ts      # Alerts
src/routes/logs.ts                # Routes
```

---

## 🎯 الأسئلة الأكيدة (100% راح تجي)

### 1. "اشرحلي الـ schema design"

**فتحي `src/db/schema.sql`** وقولي:

```
ثلاث جداول:
1. logs — الرئيسي، فيه timestamp, level, service, message, attributes (JSONB)
2. alert_rules — قواعد التنبيهات (threshold, webhook_url)
3. notifications — الإشعارات (type, title, message, is_read)

logs يستخدم TimescaleDB hypertable مقسم على timestamp — هذا يعني البيانات 
الجديدة تروح لقسم خاص والقديمة بقسم ثاني، يخلي الاستعلامات أسرع.

المفتاح الأساسي (id, timestamp) — ضروري عشان hypertable.
```

### 2. "ليه اخترتي JSONB للأتريبيوتس؟"

افتحي `src/db/schema.sql` السطر 7 أو `src/db/indexes.sql` السطر 8 وقولي:

```
لأن كل log ممكن يكون عنده خصائص مختلفة (user_id, region, retries, ip...).
JSONB يسمح بتخزين خصائص ديناميكية بدون تغيير schema كل مرة.
وفيه GIN index (السطر 8 في indexes.sql) يخلي البحث جوا الـ JSON سريع.

البديل كان EAV (entity-attribute-value) — بس JSONB أسرع وأسهل.
```

### 3. "كيف تضمنين الأداء مع مليون سجل؟"

افتحي `src/db/indexes.sql` وقولي:

```
ثلاث indexes:

1. idx_logs_service (service, timestamp DESC) — للبحث حسب الخدمة
2. idx_logs_level (level, timestamp DESC) — للبحث حسب level
3. idx_logs_attributes (GIN on attributes) — للبحث في JSONB

و cursor pagination بدال OFFSET (في logsService.ts السطر 176-181):
cursor يشفر (timestamp, id) كـ base64 ويستخدم 
WHERE (timestamp, id) < (?, ?) — يقرأ بس اللي يحتاج.
```

### 4. "كيف تشتغل الـ partial acceptance؟"

افتحي `src/services/logsService.ts` السطور 34-103 وقولي:

```
كل log يدخل validation loop:
  - timestamp: يتأكد إنه ISO 8601 وما بعد 5 دقايق
  - level: debug/info/warn/error
  - service: non-empty string
  - message: non-empty string
  - attributes: flat object فقط

اللي ينجح → ينضاف validRows → batch INSERT (parameterized)
اللي يفشل → rejected array مع index والسبب

في الآخر: HTTP 200 إذا في accepted > 0, 400 إذا الكل مرفوض.
```

### 5. "كيف تشتغل الـ cursor pagination؟"

افتحي `src/services/logsService.ts` السطور 176-198 وقولي:

```
لما تجيب limit logs:
  - Pagination العادي (OFFSET) بطيء: يقرأ كل الصفوف ويرمي الزايد
  - Cursor pagination: يشفر آخر (timestamp, id) كـ base64
  - الطلب الجاي يستخدم: WHERE (timestamp, id) < (?, ?)
  - هذا يستفيد من الـ index ولا يقرأ صفوف زيادة

السطر 191-196: next_cursor = null إذا ما في نتايج زيادة.
```

### 6. "كيف تشتغل الـ aggregation؟"

افتحي `src/services/logsService.ts` السطور 278-287 وقولي:

```
تستخدم time_bucket من TimescaleDB:
  SELECT time_bucket('1 minute', timestamp), COUNT(*)
  FROM logs WHERE ...
  GROUP BY bucket_start

bucket: 1m, 5m, 1h, 1d
group_by: service أو level (اختياري)
نفس فلاتر GET /logs.
```

### 7. "كيف الـ retention ما يوقف الـ ingestion؟"

افتحي `src/services/retentionService.ts` وقولي:

```
Batch delete: 1000 صف كل مرة
DELETE FROM logs WHERE (id, timestamp) IN (
  SELECT id, timestamp FROM logs WHERE timestamp < $1 LIMIT 1000
)

لما عدد الصفوف المحذوفة أقل من 1000 → نوقف.
هذا يضمن ما يسوي lock كبير على الجدول.

بعد الحذف، ينشئ notification:
createNotification("retention", "Retention Run Complete", ...)
```

### 8. "كيف تتعاملين مع attr.* فلاتر؟"

افتحي `src/services/logsService.ts` السطور 5-11 و 165-174 وقولي:

```
فيه function coerceAttrValue (السطر 5):
  - "true" → true boolean
  - "false" → false boolean
  - "123" → 123 number
  - غير كذا → string

في query building (السطر 165):
  for (const key in query) if (key.startsWith("attr."))
  يستخدم attributes @> '{"key": value}'::jsonb
  هذا يستغل GIN index.
```

### 9. "كيف تحمين من SQL injection؟"

افتحي `src/services/logsService.ts` السطور 96-99 وقولي:

```
كل الاستعلامات تستخدم parameterized queries ($1, $2, ...).
ما في concatenation للـ user input أبداً.

مثلاً: INSERT INTO logs VALUES ($1, $2, $3, $4, $5)
القيم تمر كـ array: [ts, level, service, message, attributesJSON]
```

---

## 🎭 أسئلة تصميم المشروع

### "ليه Express مش Fastify أو NestJS؟"
> "المشروع بسيط — dashboard بدون تعقيد. Express أسهل وأشهر. لو المشروع أكبر، كان NestJS خيار أفضل."

### "ليه Session مو JWT؟"
> "Dashboard فردي. Session أسهل وأمان. JWT أحسن للـ APIs العامة."

### "ليه ما استعملت ORM (Prisma/TypeORM)؟"
> "SQL direct يعطينا تحكم كامل بالـ queries والـ indexes. ORM أسهل لكن أداءه أقل."

### "كيف اختبرتي تحت الـ load؟"
> استخدمي `load-test.js`:
> ```
> autocannon sends 20 concurrent connections for 10s
> Target: 500 logs/sec
> ```

---

## 🔥 أصعب سؤال ممكن يجي

### "قولي لي شو نقاط الضعف في مشروعك؟"

(الصدق أفضل — قولي نقاط الضعف اللي عارفتها):

1. **ما في Rate Limiting** — أي حد يقدر يرسل مليون طلب ويوقع السيرفر
2. **ما في Cache (Redis)** — كل طلب يروح عالـ DB
3. **ما في Authentication على APIs** — POST /logs مفتوح للكل
4. **Session store في الذاكرة** — لو شغلتين سيرفرين، الـ session ما يشتغل بينهم
5. **ما في HTTPS** — كلشي plain HTTP
6. **ما في WebSockets** — الـ live updates تستخدم polling (كل 5 ثواني)
7. **الـ attribute filter ما يدعم nested objects** — flat objects فقط

وقولي: "هذي أشياء أعرفها ولو كان عندي وقت أكثر، كنت حطيتها."

---

## 📝 نموذج إجابة متكامل لسؤال "اشرحي المشروع"

> "هذا مشروع **Log Ingestion & Query Service** — نظام مركزي يجمع السجلات من تطبيقات مختلفة ويخزنها ويخلّي المستخدم يبحث فيها ويحللها. اسم الداشبورد Lumina Logs."
> 
> "استخدمت **Node.js/Express + TypeScript** للـ backend، **TimescaleDB** قاعدة بيانات (PostgreSQL مع إضافة hypertable تقسم البيانات حسب الوقت)، و **Docker** للتشغيل. الداشبورد مبني بـ **Tailwind CSS** مع CSS variables للـ dark/light theme."
> 
> "الـ ingestion يستقبل batch logs، يتحقق من صحة كل وحدة على حدة (partial acceptance)، ويدخلهم بـ batch INSERT parameterized عشان الأمان والأداء."
> 
> "الـ query يدعم فلاتر service/level/time/message/attributes، مع cursor pagination للتصفح بدون OFFSET، و time_bucket aggregation للتحليلات."
> 
> "الـ retention job تشتغل كل ساعة وتحذف logs أقدم من 30 يوم في batches (1000 صف) عشان ما تثقل السيرفر."
> 
> "فيه alert system يراقب عدد الأخطاء ويرسل webhooks وينشئ notifications، و notifications system بيعرضها لمستخدم الداشبورد."
> 
> "تحت الـ load، استخدمت indexes مدروسة (B-tree ع service/level مع timestamp DESC, GIN للـ JSONB) عشان أضمن الأداء."

---

## ⏰ قبل المناقشة بدقيقة

افتحي هالملفات على جهازك:
- `src/services/logsService.ts` (الملف الأهم)
- `src/db/indexes.sql`
- `src/db/schema.sql`
- `src/controllers/logsController.ts`
- `src/app.ts`

**تذكري:** لو ما عرفتي جواب — قولي "هذا شيء ما فكرت فيه، بس ممكن أكون استعملت X أو Y" — هذا يبين إنك تفكرين بشكل هندسي أحسن من إنك تقولين "ما بعرف".
