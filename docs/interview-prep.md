# تحضير المناقشة — سؤال وجواب

## إزاي تفتحي الكود بسرعة قبل المناقشة

```bash
# الملفات اللي بتضمن إنك تتذكرها:
# ⚠️ logsService.ts القديم انقسم لملفات — هاي البنية الحالية:
src/services/logs/insert.ts       # insertLogs + backpressure (EWMA)
src/services/logs/query.ts        # queryLogs + cursor pagination
src/services/logs/aggregate.ts    # queryAggregate + rollup fast-path
src/services/logs/rollup.ts       # in-memory rollup accumulator/flusher
src/services/logs/validation.ts   # validateLogEntry
src/services/logs/cursor.ts       # decodeCursor
src/controllers/logsController.ts # API handlers
src/app.ts                        # Setup
src/db/index.ts                   # 3 connection pools (pool/queryPool/rollupPool)
src/db/schema.sql                 # Database schema
src/db/indexes.sql                # Indexes
src/services/retentionService.ts  # Retention (drop_chunks)
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

افتحي `src/db/schema.sql` أو `src/services/logs/query.ts` سطر 74-81 وقولي:

```
لأن كل log ممكن يكون عنده خصائص مختلفة (user_id, region, retries, ip...).
JSONB يسمح بتخزين خصائص ديناميكية بدون تغيير schema كل مرة.

فلترة `attr.<key>` تستخدم `attributes @> '{"key":"value"}'::jsonb` (containment،
مو ->> — تغيّر بآخر تحديث). القيم دايماً تتخزن كـ strings (normalizeAttributes
بـ validation.ts تحول أي number/boolean لـ String قبل التخزين)، فالمقارنة نصية
حتى لو أصل القيمة number/boolean.

مافي GIN index على attributes حالياً (تم حذفه قديماً: `DROP INDEX IF EXISTS
idx_logs_attributes` في indexes.sql، ولسا محذوف). يعني: نستخدم العامل الصحيح
نظرياً للفهرسة (@> هو اللي GIN بيسرّعه)، بس بدون الفهرس نفسه — الفلتر يشتغل
كـ scan بعد فلاتر تانية (service مثلاً)، مش index scan مباشر.

ملاحظة صادقة: فلتر attr.* بـ GET /logs مش مربوط إلزامياً بـ since/until —
لو انبعت لحاله بدون حد زمني، بيصير Sequential Scan على الجدول كامل. بـ
GET /logs/aggregate الوضع أحسن لأن since/until إلزاميين هناك.

البديل كان EAV (entity-attribute-value) — بس JSONB أسرع وأسهل.
```

### 3. "كيف تضمنين الأداء مع مليون سجل؟"

افتحي `src/db/indexes.sql` وقولي:

```
⚠️ الـ indexes تغيّرت بآخر تحديث — idx_logs_level انحذف عمداً:

1. idx_logs_service_ts_id (service, timestamp DESC, id DESC) — composite،
   يخدم فلتر service + الترتيب النهائي (ORDER BY timestamp DESC, id DESC)
   بدون Sort إضافي.
2. idx_logs_timestamp_id_desc (timestamp DESC, id DESC) — يخدم pagination
   العام والاستعلامات اللي ما فيها service (يعتمد عليه level-filtered
   queries هلأ، بعد ما اتحذف idx_logs_level).
3. idx_logs_message_trgm (GIN trigram على message) — للبحث بـ ILIKE '%q%'.

idx_logs_level اتحذف قصداً: level عنده 4 قيم بس (low-cardinality)، فتحت
concurrent inserts كل الـ batches كانت تتزاحم على نفس صفحات الـ btree —
قياس فعلي: 500-row insert من 9ms لـ 21.5ms بوجوده، وكان يحدد سقف ingestion
عند ~5-8k logs/sec. تم التضحية بسرعة level-filtered queries عشان نحرر
ingestion throughput (شوفي docs/hard-questions.md سؤال 15 لتفصيل أعمق).

مافي index على attributes (chunk exclusion جزئي بس، شوفي سؤال 2 — مش كافي
لو الطلب بلا since/until).

cursor pagination بدال OFFSET (src/services/logs/query.ts سطر 83-88،
decodeCursor بـ cursor.ts):
cursor يشفر (timestamp, id) كـ base64 ويستخدم
WHERE (timestamp, id) < (?, ?) — يقرأ بس اللي يحتاج.
```

### 4. "كيف تشتغل الـ partial acceptance؟"

افتحي `src/services/logs/validation.ts` (validateLogEntry) و `src/services/logs/insert.ts` (insertLogs) وقولي:

```
كل log يدخل validation loop (validateLogEntry بـ validation.ts):
  - timestamp: يتأكد إنه تاريخ صحيح وما بعد 5 دقايق بالمستقبل
  - level: debug/info/warn/error
  - service: non-empty string
  - message: non-empty string
  - attributes: flat object فقط (normalizeAttributes تحول كل قيمة لـ String)

اللي ينجح → ينضاف validRows → batch INSERT (parameterized) عن طريق unnest()
اللي يفشل → rejected array مع index والسبب

في الآخر: HTTP 200 إذا في accepted > 0, 400 إذا الكل مرفوض (logsController.ts).

⚠️ فيه طبقة قبل الـ validation لسا: لو insertLatencyEwmaMs (قياس latency
الإدخال الأخير) تجاوز MAX_INSERT_LATENCY_MS، الطلب كامل يترفض فوراً بـ
IngestOverloadedError (→ 503) قبل حتى ما يوصل الـ validation — هذا الـ
backpressure، شوفي سؤال 10 بالأسفل.
```

### 5. "كيف تشتغل الـ cursor pagination؟"

افتحي `src/services/logs/query.ts` و `src/services/logs/cursor.ts` وقولي:

```
لما تجيب limit logs:
  - Pagination العادي (OFFSET) بطيء: يقرأ كل الصفوف ويرمي الزايد
  - Cursor pagination: يشفر آخر (timestamp, id) كـ base64 (query.ts سطر 100-102)
  - الطلب الجاي يستخدم: WHERE (timestamp, id) < (?, ?) (query.ts سطر 83-88)
  - هذا يستفيد من الـ index ولا يقرأ صفوف زيادة

decodeCursor بـ cursor.ts محمي بـ try/catch + التحقق من الشكل (timestamp
نص و id رقم) — أي فشل يرمي "invalid cursor" بدل ما يكسر الاستعلام.

next_cursor = null إذا رجع أقل من limit نتيجة (يعني هاي آخر صفحة).
```

### 6. "كيف تشتغل الـ aggregation؟ وشو الـ rollup اللي ضفتوه؟"

افتحي `src/services/logs/aggregate.ts` و `src/services/logs/rollup.ts` وقولي:

```
تستخدم time_bucket من TimescaleDB، بس فيها مسارين هلأ:

1. المسار السريع (useRollup = true، لما ما فيه attr.*/q):
   بيقرأ من جدول logs_rollup_1m (pre-aggregated، صف واحد لكل دقيقة/service/level)
   بدل ما يمسح logs الخام:
     SELECT time_bucket('1 hour', bucket_start), SUM(count)
     FROM logs_rollup_1m WHERE ... GROUP BY bucket

   logs_rollup_1m يتغذى من accumulator بالذاكرة (rollup.ts) يتجمع وقت كل
   insert (بدون DB write)، وينفلش كل 150ms بدفعة واحدة (unnest، named
   prepared statement flush_rollup). أي deltas لسا ما انفلشت (pendingRollup)
   تنضم يدوياً على نتيجة الـ SQL (mergePendingRollupIntoBuckets) عشان
   الاستعلام يشوف حتى آخر بيانات ما انكتبت لسا.

2. المسار البطيء (raw-scan fallback، لما فيه attr.*/q):
   بيرجع لمسح logs الخام مباشرة (بما إن الـ rollup ما بيتتبع إلا
   service/level/count بالدقيقة، مش attributes أو message).

bucket: 1m, 5m, 1h, 1d
group_by: service أو level (اختياري)
since/until إلزاميين بالمسارين.
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

افتحي `src/services/logs/query.ts` سطر 74-81 وقولي:

```
for (const key in query) if (key.startsWith("attr."))
  attrKey = key.slice(5)  // اسم الـ attribute بعد "attr."
  conditions.push(`attributes @> $paramIndex::jsonb`)
  values.push(JSON.stringify({ [attrKey]: String(query[key]) }))

⚠️ هذا @> (containment) مش ->> — تغيّر بآخر تحديث. القيمة تتحول لـ String
دايماً عشان تطابق كيف بتخزن (normalizeAttributes بـ validation.ts). القيمة
كلها بتروح كـ bound parameter (JSON.stringify نتيجته)، مش concatenation —
آمنة من SQL injection.

مافي GIN index هون (اتحذف قديماً). صراحة: الفلتر هذا مش مربوط إلزامياً
بـ since/until بـ GET /logs — لو انبعت لحاله، بيصير Sequential Scan كامل.
هذا نقطة ضعف حقيقية بالتصميم، مو محلولة بالكامل لسا.
```

### 9. "كيف تحمين من SQL injection؟"

افتحي `src/services/logs/insert.ts` وقولي:

```
كل الاستعلامات تستخدم parameterized queries ($1, $2, ...).
ما في concatenation للـ user input أبداً.

بس الآلية تطورت: بدل ما نبني VALUES ($1,$2,...), ($6,$7,...), ... لكل صف
(نص استعلام يكبر مع حجم الـ batch)، نستخدم unnest():

INSERT INTO logs (timestamp, level, service, message, attributes)
SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::jsonb[])

هنا كل parameter مصفوفة وحدة تمثل عمود كامل (مو صف)، فمهما كان حجم الـ batch
(200 أو 500 log) الاستعلام نفسه ثابت الحجم — 5 parameters بس. هذا يمنع
Postgres من إعادة parse/plan لاستعلام متغير الحجم كل مرة، وهو جزء من سلسلة
تحسينات وصلت بالـ throughput المُقاس على البنشمارك الرسمي لـ ~13,780-15,625
logs/sec sustained (شوفي سؤال "كيف اختبرتي تحت الـ load؟" بالأسفل للتفصيل).

الحماية من SQL injection نفسها ما تغيرت: القيم دايماً تروح كـ bound
parameters، سواء array عادي أو array-per-column مع unnest.

إضافة أخيرة: الاستعلام هذا سمّيته named prepared statement (`name:
"insert_logs"`) — بما إن نصه ثابت دايماً، Postgres يعمل parse/plan مرة
وحدة بس لكل اتصال، وبعدها bind-and-execute بس. مش له علاقة بالأمان (كان
آمن أصلاً بالـ parameterized values) — بس تحسين أداء إضافي.
```

### 10. "كيف تتعاملين مع الحمل الزايد (overload) بالـ ingestion؟"

افتحي `src/services/logs/insert.ts` وقولي:

```
عندي backpressure مبني على latency مقاسة فعلياً، مش على عدد اتصالات أو
queue depth (اللي بتعتمد على الهاردوير وممكن تغلط لو تغير):

- كل insert بقيس مدة تنفيذه الفعلية، وبحدث EWMA (moving average، alpha=0.2)
  لـ insertLatencyEwmaMs.
- لو EWMA تجاوزت MAX_INSERT_LATENCY_MS (10 ثواني = نص الـ SLA اللي هو
  20 ثانية)، أي batch جديد يترفض فوراً برمي IngestOverloadedError
  (logsController.ts يحولها لـ 503 + header Retry-After).
- عشان الـ gate ما تعلق مقفولة للأبد (لأنه رفض batch ما بيولّد sample
  جديد)، فيه "probe": كل PROBE_INTERVAL_MS (نص ثانية) نسمح لطلب واحد
  يعدي ليقيس الوضع الحقيقي — لو Postgres رجع طبيعي، EWMA تنزل والـ gate
  تفتح لحالها.

المنطق: شحن batch جديد وقت overload بيضمن إنه يفوت الـ SLA أصلاً (لأنه
راح يستنى خلف batches عالقة)، فالأرخص نرفضه فوراً (شedding) بدل ما نضيف
طابور بيفشل لاحقاً. Batch مرفوض ما بيتحسب accepted ولا rejected — بيتحسب
مرفوض بالكامل (503)، مش partial acceptance.
```

---

## 🎭 أسئلة تصميم المشروع

### "ليه Express مش Fastify أو NestJS؟"
> "المشروع بسيط — dashboard بدون تعقيد. Express أسهل وأشهر. لو المشروع أكبر، كان NestJS خيار أفضل."

### "ليه Session مو JWT؟"
> "Dashboard فردي. Session أسهل وأمان. JWT أحسن للـ APIs العامة."

### "ليه ما استعملت ORM (Prisma/TypeORM)؟"
> "SQL direct يعطينا تحكم كامل بالـ queries والـ indexes. ORM أسهل لكن أداءه أقل."

### "ليه فيه 3 connection pools منفصلة بدل واحد؟"
> "Postgres هون 1 core بس، فالمشكلة تزاحم بين أحمال مختلفة الطابع (insert السريع/الحرج مقابل aggregate البطيء أحياناً مقابل rollup flush الدوري) — pools منفصلة (pool/queryPool/rollupPool) بحدود واتصالات وصلاحيات (statement_timeout) مختلفة تعزلهم عن بعض. تفصيل كامل بـ docs/hard-questions.md سؤال 16."

### "كيف اختبرتي تحت الـ load؟ وشو رقم الـ throughput الصح احكيه؟"

⚠️ **مهم جداً:** فيه رقمين مختلفين — لازم تعرفي تميزي بينهم وما تخلطيهم:

> **1. اختبار محلي بسيط (`load-test.js`, autocannon):**
> ```
> BATCH_SIZE=500 CONNECTIONS=8 DURATION=20 node load-test.js
> (الافتراضي: batch=200, 20 اتصال, 20 ثانية)
> ```
> محلياً (README) هذا أعطى مدى ~8,700–17,000 logs/sec، بيتغير حسب مدة
> التشغيل (runs قصيرة ~15-25s جابت أرقام أعلى من runs مستمرة ~90s على نفس
> الجهاز) — هذا رقم **توجيهي** (يأكد أي تغيير ساعد وبأي قدر تقريبي)، مش رقم
> نهائي.
>
> **2. الرقم الرسمي المُعتمد — من الـ grading benchmark الفعلي:**
> ```
> 13,780–15,625 logs/sec sustained
> عبر 4 سيناريوهات (Load/Stress/Spike/Breakpoint)
> كلا الـ containers تحت 30% CPU بالمعدل — فيه هامش (headroom) لسا
> ```
> هذا الرقم هو اللي لازم أذكره لو سُئلت "شو throughput مشروعك؟" — مو رقم
> `load-test.js` المحلي.
>
> **نقطة دقيقة كمان:** الـ load generator الفعلي بيرسل batches أصغر بكثير
> من افتراض `load-test.js` — batch=33 logs لكل request، حتى 70 concurrent
> VUs (مو batch=200-500). البنشمارك تحت هالحمل الفعلي bottleneck مختلف:
> عند batch=33 تكلفة كل request الثابتة (Express/JSON parse/pg round-trip)
> تسيطر أكثر من تكلفة كل صف بالداتابيس — عكس batch=500 اللي فيه db CPU هو
> المحدد. لو سُئلت "وش لو الـ batch size أصغر؟" هاي بالضبط النقطة.
>
> **مهم أيضاً:** logs/sec (سجل بالثانية) مو requests/sec — كل request بيحمل
> batch كامل، فلو حسبناه requests/sec الرقم يكون أوطى بكثير. وضحي هالفرق
> بالمقابلة عشان ما يفهم المُقابل إنك تقصدين عدد الـ HTTP requests.

---

## 🔥 أصعب سؤال ممكن يجي

### "قولي لي شو نقاط الضعف في مشروعك؟"

(الصدق أفضل — قولي نقاط الضعف اللي عارفتها):

1. **ما في Rate Limiting** — أي حد يقدر يرسل مليون طلب ويوقع السيرفر
2. **ما في Cache (Redis)** — الاستعلامات اللي فيها attr/q تروح raw scan كل مرة
3. **ما في Authentication على APIs** — POST /logs مفتوح للكل
4. **Session store في الذاكرة** — لو شغلتين سيرفرين، الـ session ما يشتغل بينهم
5. **ما في HTTPS** — كلشي plain HTTP
6. **ما في WebSockets** — الـ live updates تستخدم polling (كل 5 ثواني)
7. **الـ attribute filter ما يدعم nested objects** — flat objects فقط
8. **attr.\* بـ GET /logs مش مربوط إلزامياً بـ since/until** — لو انبعت لحاله
   بدون حد زمني وبدون index على attributes، بيصير Sequential Scan على
   الجدول كامل. الحل الأسهل: أفرض since/until إلزاميين لما فيه attr.* —
   نفس القيد الموجود أصلاً بـ queryAggregate.
9. **level-filtered queries صارت أبطأ عمداً** — بعد حذف idx_logs_level
   (كان يسبب lock contention يحد ingestion لـ ~5-8k logs/sec)، صار
   level=error مثلاً يعتمد على idx_logs_timestamp_id_desc + filter بعد
   الـ index scan، مش index scan مباشر على level.
10. **الـ rollup ما بيغطي أي استعلام فيه attr/q** — بيرجع لمسح logs الخام
    كل مرة لهاي الحالة، فما فيه فايدة أداء من الـ rollup لهالنوع من الفلاتر.

وقولي: "هذي أشياء أعرفها ولو كان عندي وقت أكثر، كنت حطيتها."

---

## 📝 نموذج إجابة متكامل لسؤال "اشرحي المشروع"

> "هذا مشروع **Log Ingestion & Query Service** — نظام مركزي يجمع السجلات من تطبيقات مختلفة ويخزنها ويخلّي المستخدم يبحث فيها ويحللها. اسم الداشبورد Lumina Logs."
> 
> "استخدمت **Node.js/Express + TypeScript** للـ backend، **TimescaleDB** قاعدة بيانات (PostgreSQL مع إضافة hypertable تقسم البيانات حسب الوقت)، و **Docker** للتشغيل. الداشبورد مبني بـ **Tailwind CSS** مع CSS variables للـ dark/light theme."
> 
> "الـ ingestion يستقبل batch logs، يتحقق من صحة كل وحدة على حدة (partial acceptance)، ويدخلهم بـ batch INSERT parameterized عن طريق unnest() (مصفوفة وحدة لكل عمود، named prepared statement) عشان الأمان والأداء. فوقه فيه backpressure: بقيس latency الإدخال الفعلي (EWMA)، ولو تجاوز نص الـ SLA برفض batches جديدة فوراً (503) بدل ما أضيف طابور بيفشل أصلاً."
> 
> "الـ query يدعم فلاتر service/level/time/message/attributes، مع cursor pagination للتصفح بدون OFFSET، و time_bucket aggregation للتحليلات. الـ aggregation له مسار سريع: in-memory rollup accumulator يتجمع وقت الـ insert (بدون تكلفة على مسار الكتابة) وينفلش كل 150ms لجدول logs_rollup_1m، فمعظم استعلامات aggregate تقرأ منه بدل ما تمسح logs الخام."
> 
> "الـ retention job تشتغل كل ساعة وتحذف logs أقدم من 30 يوم عن طريق drop_chunks() — تحذف الـ TimescaleDB chunks الكاملة الأقدم من الـ cutoff كعملية metadata سريعة، بدل حذف صفوف على دفعات، فما تعمل تعارض مع الـ ingestion."
> 
> "فيه alert system يراقب عدد الأخطاء ويرسل webhooks وينشئ notifications، و notifications system بيعرضها لمستخدم الداشبورد."
> 
> "تحت الـ load، الـ indexes مبنية على قياس فعلي مش تخمين: composite index على (service, timestamp DESC, id DESC) يخدم الفلترة والترتيب مع، وحذفت index كان على level لأنه سبب lock contention (low-cardinality) كان يحد الـ ingestion لـ 5-8k logs/sec. attributes مافيها index أصلاً — فلترتها (`@>`) بتعتمد على chunk exclusion من since/until لما يكون موجود، وهاد نقطة ضعف صريحة لو الطلب بلا حد زمني."

---

## ⏰ قبل المناقشة بدقيقة

افتحي هالملفات على جهازك:
- `src/services/logsService.ts` (الملف الأهم)
- `src/db/indexes.sql`
- `src/db/schema.sql`
- `src/controllers/logsController.ts`
- `src/app.ts`

**تذكري:** لو ما عرفتي جواب — قولي "هذا شيء ما فكرت فيه، بس ممكن أكون استعملت X أو Y" — هذا يبين إنك تفكرين بشكل هندسي أحسن من إنك تقولين "ما بعرف".
