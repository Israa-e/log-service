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

مافي GIN index على attributes — تم حذفه عمداً (`DROP INDEX IF EXISTS idx_logs_attributes`
في indexes.sql). فلترة `attr.<key>` تستخدم `attributes ->> $key = $value` (نص مقارن بنص،
عشان الأنواع المختلطة string/number/boolean تتقارن صح). GIN بيسرّع بس عامل الـ containment
`@>`، مش `->>`، والمفتاح نفسه ديناميكي حسب كل request فما بينبنى له index ثابت. بدلها بنعتمد
على TimescaleDB chunk exclusion: أي فلتر لازم يجي مع since/until، فبوستجرس يتجاهل الـ chunks
اللي برا النطاق الزمني قبل ما يلمس attributes أصلاً.

البديل كان EAV (entity-attribute-value) — بس JSONB أسرع وأسهل.
```

### 3. "كيف تضمنين الأداء مع مليون سجل؟"

افتحي `src/db/indexes.sql` وقولي:

```
ثلاث indexes فعلية (زائد hypertable partitioning تلقائي حسب timestamp):

1. idx_logs_service (service, timestamp DESC) — للبحث حسب الخدمة
2. idx_logs_level (level, timestamp DESC) — للبحث حسب level
3. idx_logs_message_trgm (GIN trigram على message) — للبحث بـ ILIKE '%q%'

مافي index على attributes — تم حذفه (chunk exclusion كافي، شوفي سؤال 2).

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

اللي ينجح → ينضاف validRows → batch INSERT (parameterized) عن طريق unnest()
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
مو batch delete — استدعاء واحد بس:
SELECT drop_chunks('logs', older_than => $1::timestamptz)

logs جدول hypertable في TimescaleDB، مقسم داخلياً لـ "chunks" حسب فترة زمنية
(افتراضياً 7 أيام). drop_chunks() تحذف الـ chunk كامل كعملية metadata (زي
DROP TABLE) بدل ما تحذف صف صف — فما فيه تقريباً أي تعارض (lock contention)
مع الـ INSERTs الشغالة بنفس الوقت.

الأثر الجانبي: الحذف يصير فقط للـ chunk الكامل الأقدم من الـ cutoff، يعني
دقة الاحتفاظ (retention) صارت ~مدة chunk واحد (7 أيام افتراضياً) مو دقة اليوم
بالضبط — لو الـ cutoff نص chunk، الصفوف اللي جوا نفس الـ chunk بعد الـ cutoff
تضل موجودة لحد ما الـ chunk كامل يصير أقدم من الـ cutoff.

قبل drop_chunks نعمل COUNT(*) تقريبي بس للتقرير/الـ notification، مو جزء من
منطق الحذف نفسه:
createNotification("retention", "Retention Run Complete", ...)
```

### 8. "كيف تتعاملين مع attr.* فلاتر؟"

افتحي `src/services/logsService.ts` السطور 194-201 وقولي:

```
for (const key in query) if (key.startsWith("attr."))
  attrKey = key.slice(5)  // اسم الـ attribute بعد "attr."
  conditions.push(`attributes ->> $paramIndex = $paramIndex+1`)
  values.push(attrKey, query[key])

يعني المقارنة كلها نصية (attributes ->> key بترجع text)، وباراميترز
(attrKey والقيمة) مو string concatenation — آمنة من SQL injection.

مافي GIN index هون (اتحذف، شوفي سؤال 2) — الحماية من full scan تجي من
إن الفلتر لازم يترافق مع since/until فيستفيد من chunk exclusion.
```

### 9. "كيف تحمين من SQL injection؟"

افتحي `src/services/logsService.ts` السطور 96-99 وقولي:

```
كل الاستعلامات تستخدم parameterized queries ($1, $2, ...).
ما في concatenation للـ user input أبداً.

بس الآلية تطورت: بدل ما نبني VALUES ($1,$2,...), ($6,$7,...), ... لكل صف
(نص استعلام يكبر مع حجم الـ batch)، نستخدم unnest():

INSERT INTO logs (timestamp, level, service, message, attributes)
SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::jsonb[])

هنا كل parameter مصفوفة وحدة تمثل عمود كامل (مو صف)، فمهما كان حجم الـ batch
(200 أو 500 log) الاستعلام نفسه ثابت الحجم — 5 parameters بس. هذا يمنع
Postgres من إعادة parse/plan لاستعلام متغير الحجم كل مرة، وهو أحد أسباب
تحسن الأداء لـ ~15,000-17,700 log/sec.

الحماية من SQL injection نفسها ما تغيرت: القيم دايماً تروح كـ bound
parameters، سواء array عادي أو array-per-column مع unnest.
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
> كل request فيه batch من 200-500 logs
> Measured: ~15,000-17,700 logs/sec
> ```
> **مهم:** هذا رقم logs/sec (سجل بالثانية) مو requests/sec — لأن كل request
> واحد يحمل batch كامل (200-500 سجل)، فلو حسبناه requests/sec الرقم راح
> يكون أوطى بكثير. الفرق هذا مهم توضحيه في المقابلة عشان ما يفهم إنك تقصدين
> عدد الـ HTTP requests.

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
> "الـ ingestion يستقبل batch logs، يتحقق من صحة كل وحدة على حدة (partial acceptance)، ويدخلهم بـ batch INSERT parameterized عن طريق unnest() (مصفوفة وحدة لكل عمود) عشان الأمان والأداء — قست ~15,000-17,700 log/sec."
> 
> "الـ query يدعم فلاتر service/level/time/message/attributes، مع cursor pagination للتصفح بدون OFFSET، و time_bucket aggregation للتحليلات."
> 
> "الـ retention job تشتغل كل ساعة وتحذف logs أقدم من 30 يوم عن طريق drop_chunks() — تحذف الـ TimescaleDB chunks الكاملة الأقدم من الـ cutoff كعملية metadata سريعة، بدل حذف صفوف على دفعات، فما تعمل تعارض مع الـ ingestion."
> 
> "فيه alert system يراقب عدد الأخطاء ويرسل webhooks وينشئ notifications، و notifications system بيعرضها لمستخدم الداشبورد."
> 
> "تحت الـ load، استخدمت indexes مدروسة (B-tree ع service/level مع timestamp DESC، GIN trigram على message للبحث النصي) — وما استخدمت index على attributes لأنه مافي index بيسرّع `->>` مع مفتاح ديناميكي، فاعتمدت على chunk exclusion بدلها."

---

## ⏰ قبل المناقشة بدقيقة

افتحي هالملفات على جهازك:
- `src/services/logsService.ts` (الملف الأهم)
- `src/db/indexes.sql`
- `src/db/schema.sql`
- `src/controllers/logsController.ts`
- `src/app.ts`

**تذكري:** لو ما عرفتي جواب — قولي "هذا شيء ما فكرت فيه، بس ممكن أكون استعملت X أو Y" — هذا يبين إنك تفكرين بشكل هندسي أحسن من إنك تقولين "ما بعرف".
