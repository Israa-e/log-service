# أسئلة صعبة جداً — Advanced

السؤال اللي يخليك تثبت إنك فاهمة deep understanding.

---

## 🧠 الـ 10 أسئلة الأصعب

### سؤال 1: "شو الفرق بين `->>` و `@>` بالفلترة على attributes؟ وهل عندكم index يخدمها؟"

⚠️ **تحديث:** هذا مختلف عن أي نسخة سابقة من هذا المستند تقول إن الكود يستخدم `->>` — الكود
الحالي (`query.ts` سطر 74-81 و `aggregate.ts` سطر 106-111) يستخدم `@>` (containment).

**الجواب:**
```
الكود الحالي:
  attributes @> $N::jsonb     -- مع value = JSON.stringify({ [attrKey]: String(v) })

مش:
  attributes ->> 'key' = value

السبب المنطقي: @> هو نفس العامل اللي GIN index بيسرّعه فعلياً (بعكس ->> اللي
ما فيه GIN عام يسرّعه أصلاً). لكن — وهذي النقطة المهمة — indexes.sql الحالي
ما فيه GIN index على attributes خالص (اتحذف قديماً كـ idx_logs_attributes
ولسا مو موجود). يعني: صرنا نستخدم العامل الصحيح نظرياً للفهرسة، بس بدون
الفهرس نفسه — الفلتر يشتغل كـ scan/filter، مش index scan.

نقطة أهم: على عكس الافتراض القديم، فلتر attr.* بـ GET /logs (query.ts) **مش
مربوط إلزامياً بـ since/until**. لو المستخدم بعت:
  GET /logs?attr.region=eu-west
من غير since/until، الاستعلام يصير:
  SELECT * FROM logs WHERE attributes @> '{"region":"eu-west"}'::jsonb ...
بدون أي حد زمني → لا chunk exclusion ولا index → Sequential Scan على
الـ hypertable كامل. هذا نقطة ضعف حقيقية بالتصميم الحالي، وصادقة أذكرها لو
سُئلت "وين أضعف نقطة بالكود؟".

في queryAggregate (aggregate.ts) الوضع أحسن: since/until إلزاميين (يرمي error
واضح لو غايبين)، فالـ raw-scan fallback (لما فيه attr.*/q) دايماً محدود
بنطاق زمني على الأقل — حتى لو بلا index.
```

### سؤال 2: "في استعلام aggregate مع `bucket=1m` و `group_by=service` — شو بيصير لو في مليون صف؟ كيف تضمنين تحت 1 ثانية؟"

**الجواب:**
```
ثلاث عوامل تخليها سريعة:
1. time_bucket من TimescaleDB — يستخدم hypertable sorting على timestamp
2. الفلاتر تستخدم indexes لما تكون service/level:
   - service → idx_logs_service (service, timestamp DESC)
   - level → idx_logs_level (level, timestamp DESC)
   - attr.* → مافيها index (اتحذف)، بتعتمد على chunk exclusion من since/until بدلها
3. الـ Sequential scan بعد الفلترة بيكون محدود

الأهم: لأن عندي (timestamp, id) composite key و hypertable مقسم على timestamp — 
الـ time_bucket يقرأ بس الأقسام اللي يحتاجها، مش كل الجدول.
```

### سؤال 3: "إيش المشكلة لو سوت الـ retention DELETE مباشرة صف صف؟ وكيف الكود الحالي يتجنبها؟"

⚠️ **تحديث:** الكود الحالي ما بيسوي batch DELETE بحلقة أصلاً — بيستخدم `drop_chunks()`.

**الجواب:**
```
DELETE FROM logs WHERE timestamp < cutoff على جدول فيه ملايين الصفوف يعني:
  - WAL كبير + عمل vacuum لاحق على ملايين الـ tombstones
  - Lock/تنافس مع INSERTs الشغالة بنفس الوقت طول مدة التنفيذ

retentionService.ts الحالي يستخدم عملية TimescaleDB على مستوى الـ hypertable:

  SELECT drop_chunks('logs', older_than => cutoff)

هذا يحذف كل "chunk" (قسم زمني كامل، افتراضياً 7 أيام) الأقدم بالكامل من cutoff
كعملية metadata (شبه DROP TABLE) — بدون لمس صف صف، وبدون تعارض حقيقي مع
inserts الشغالة على chunks أحدث.

الأثر الجانبي: الـ chunk ما ينحذف إلا لو **كامل** أقدم من cutoff، يعني دقة
الاحتفاظ الفعلية ~مدة chunk واحد (7 أيام) مش دقيقة لليوم بالضبط. الكود يحسب
COUNT(*) قبل الحذف بس لغرض التقرير/notification — هذا العدد ممكن يكون أكبر
شوي من العدد المحذوف فعلياً (نفس سبب الـ chunk boundary)، مش جزء من منطق
الحذف نفسه.

نقطة إضافية بالكود الحالي: logs_rollup_1m جدول عادي (مش hypertable)، فـ
drop_chunks على logs ما بيلمسه. فيه DELETE عادي منفصل بعده:
  DELETE FROM logs_rollup_1m WHERE bucket_start < cutoff
وهذا رخيص لأن عدد صفوفه محكوم بعدد الدقايق × عدد تركيبات (service, level)
المختلفة، مش بحجم logs الخام — فما يحتاج batching.
```

### سؤال 4: "ليه جعلتي الـ cursor base64 مش plain JSON؟ وهل في مشكلة أمنية؟"

**الجواب:**
```
Base64 عشان:
1. الـ URL parameters أحياناً ما تتقبل أحرف خاصة ({}:)
2. يخلي الـ cursor "opaque" — المستخدم/الـ client ما يقدر يقرأه بسهولة
3. اللود جنريتور يمرره زي ما هو

المشكلة الأمنية: الـ cursor مش مشفر (base64 = مجرد تشفير). 
المستخدم يقدر يفك تشفيره ويشوف آخر (timestamp, id) — لكن هذا مش sensitive data.

في logsService.ts سطر 177:
Buffer.from(JSON.stringify({ timestamp, id })).toString("base64")
```

### سؤال 5: "شو يصير لو أرسلت 1000 log وكلهم `attributes` فيهم nested objects؟"

**الجواب:**
```
كل log يدخل validation loop (logsService.ts سطر 65-74):
  for (const [k, v] of Object.entries(log.attributes))
    if (v != null && typeof v === "object")
      rejected.push({ index, reason: "nested object in attribute 'k'" })

النتيجة:
{
  accepted: 0,
  rejected: [
    { index: 0, reason: "nested object in attribute 'user'" },
    { index: 1, reason: "nested object in attribute 'metadata'" },
    ...
  ]
}

HTTP status 400 لأن accepted = 0 (logsController.ts سطر 14).
```

### سؤال 6: "لو عندك استعلام `GET /logs?service=checkout&attr.region=eu-west&q=declined` — أي index يخدّم كل فلتر؟"

⚠️ **تحديث:** اسم/بنية الـ service index تغيّرت (صار composite)، وفلتر attributes صار `@>`.

**الجواب:**
```
1. service=checkout → idx_logs_service_ts_id (service, timestamp DESC, id DESC)
   Index Scan مباشر، وبيرجع النتايج مرتبة جاهزة (بدون Sort إضافي لـ
   ORDER BY timestamp DESC, id DESC).

2. attr.region=eu-west → attributes @> '{"region":"eu-west"}'::jsonb
   مافيه GIN index على attributes حالياً. بدون since/until بهاي الحالة، هذا
   فلتر بعد الـ index scan الأول (أو Sequential Scan لو ما فيه service/
   since أصلاً) — شوفي سؤال 1 لتفصيل هذي النقطة.

3. q=declined → message ILIKE '%declined%'
   idx_logs_message_trgm (GIN trigram) ممكن الـ planner يستخدمه، وإلا فلتر
   عادي بعد النتايج.

الـ planner غالباً يبدأ بـ idx_logs_service_ts_id (الأكثر تحديداً وعنده index
جاهز)، وبعدين يطبق attr و q كـ filter على النتايج القليلة اللي خرجت من فلتر
service. لاحظي: idx_logs_level مش موجود أصلاً هلأ (شوفي سؤال 15 بالقسم
الجديد) — فلو الاستعلام كان فيه level بدل service، ما رح يستفيد من index
مخصص خالص.
```

### سؤال 7: "ليه ما استعملتي UUID للـ id وجعلتيه SERIAL integer؟"

**الجواب:**
```
SERIAL أسرع:
1. Integer أصغر (4 بايت) من UUID (16 بايت)
2. Index على integer أسرع
3. الـ cursor pagination يستخدم id للمقارنة — integer مقارنته أسرع

UUID لو استعملته:
- أمان: ما يقدر المستخدم يخمن id (مثلاً id=1, id=2)
- لكن مع cursor pagination، الـ id أصلاً مش مكشوف للمستخدم
- والتوقيت مش مناسب لـ logs (الأداء يهم أكثر من الأمان)

ملاحظة: المفتاح الأساسي (id, timestamp) — id SERIAL مع timestamp TIMESTAMPTZ
هذا مركب ضروري لـ TimescaleDB hypertable.
```

### سؤال 8: "تصوري لو بدنا ندعم البحث في nested attributes — شو التغييرات اللي تسويها؟"

**الجواب:**
```
حالياً (logsService.ts سطر 65):
if (v != null && typeof v === "object")
  rejected.push(...)  // ممنوع

لو بدنا ندعم nested:
1. نخلي attributes تقبل nested objects
2. في الـ query:
   - attr.user.name → لازم نفصل الـ key على النقاط ونستخدم path extraction:
     attributes #>> '{user,name}' = value (بدل ->> اللي بتشتغل بس مع top-level key)
   - نفس القيد القديم: ما فيه index عام يسرّع #>> لأن الـ path نفسه ديناميكي —
     برضو رح نعتمد على chunk exclusion، مش على index جديد

التحدي:
- تعقيد الـ query builder: لازم يفرّق بين top-level key (->>) و nested path (#>>)
- التعقيد: الـ load testing وقياس تأثير الـ path parsing

التغيير اللي أسويه:
- أشيل الـ validation اللي يمنع nested (السطور 65-74)
- الـ query builder يحتاج تغيير: يفحص إذا الـ key فيه نقطة، يبني path array، ويستخدم #>>
  بدل ->>
```

### سؤال 9: "عندي 10M logs ونظامك بطيء — شو أول 3 أشياء تفحصيها؟"

**الجواب:**
```
1. EXPLAIN ANALYZE
   أشوف هل الـ queries تستخدم indexes ولا لا.
   متوقع: Index Scan على service/level، Sequential Scan لو الفلتر attr.<key>
   بدون since/until (مافيه index يغطيه)، Bitmap Index Scan على idx_logs_message_trgm
   لو فيه q=

2. checkpoint configuration
   PostgreSQL default checkpoint_segments يمكن صغير
   مع 10M logs، checkpoint intervals متقاربة → I/O bottleneck

3. work_mem
   لو aggregation sorting يستخدم disk بدال memory
   time_bucket مع GROUP BY يحتاج sort — لو memory قليل، يستخدم disk

تحت الـ load:
- pg_stat_activity → أشوف لو في queries معلقة
- pg_locks → أشوف retention job مسوي lock
- index usage → أشوف أي index ما استعمل
```

### سؤال 10 (الأصعب): "في GET /logs، ليش رتبتي `ORDER BY timestamp DESC, id DESC` مش `timestamp DESC` بس؟"

**الجواب:**
```
لأنه في احتمال timestamp متساوي (نفس المللي ثانية).

لو استعملت timestamp DESC بس:
  - سجلين بنفس timestamp → الترتيب غير مضمون
  - الـ cursor بيجيب الصفحة اللي بعدها، بس ممكن يكرر أو يفقد records

مع (timestamp DESC, id DESC):
  - كل row له id فريد (SERIAL)
  - الـ tie-breaking مضمون
  - الـ cursor (timestamp, id) يضمن continuity

نفس الفلسفة في:
- الـ PRIMARY KEY (id, timestamp) المركب
- الـ indexes (service, timestamp DESC) و (level, timestamp DESC)
  - timestamp DESC في الـ index عشان ORDER BY timestamp DESC يستفيد من الـ index مباشرة
  - بدون DESC، PostgreSQL يسوي Sort بعد الـ Index Scan
```

---

## 🆕 أسئلة على آخر التغييرات (Backpressure / Rollup / Indexes / Prepared Statements)

هذا الجزء الأحدث بالكود (آخر 4-5 commits) — أعلى احتمال يسأل عنه المُقابل لأنه أحدث شي أضفتيه.

### سؤال 11: "ليه استخدمتوا latency (EWMA) للـ backpressure مش queue depth أو عدد الاتصالات؟"

**الجواب:**
```
threshold على queue depth أو عدد connections بيعتمد على الهاردوير: عتبة
مضبوطة على جهاز معين (Postgres يعالج 20 اتصال بسهولة) ممكن تكون غلط تماماً
على جهاز آخر (2k logs/sec مقابل 20k logs/sec). latency (EWMA لمدة تنفيذ
استعلام الإدخال) قياس مباشر لتأثير الـ overload الفعلي، وثابت المعنى بغض
النظر عن الهاردوير.

insert.ts: MAX_INSERT_LATENCY_MS = 10_000 — نص SLA الظهور (20 ثانية). المنطق:
لو استمر latency الإدخال فوق هالعتبة، أي batch جديد بينضاف عليه راح يفوت
الـ SLA أصلاً حتى لو انضاف بنجاح لاحقاً — فبدل ما نضيف طابور أطول (ونضمن فشل
مستقبلي)، نرفضه فوراً بـ 429/503. النص الثاني من الـ SLA يترك هامش لـ rollup
flush وقراءات الاستعلامات المتزامنة.
```

### سؤال 12: "شو وظيفة الـ 'probe request' كل 500ms بالـ backpressure؟ شو يصير لو ما كانت موجودة؟"

**الجواب:**
```
EWMA بتتحدث بس من latency inserts فعلية. لو الـ gate صار يرفض كل شي (لأن
EWMA فوق العتبة)، ما رح ينفذ insert جديد → ما رح يجي sample جديد → EWMA
بتضل عالقة فوق العتبة للأبد حتى لو Postgres رجع طبيعي فعلياً. بدون هالحل
الوحيد كان إعادة تشغيل الـ process.

الحل (PROBE_INTERVAL_MS = 500): كل نص ثانية، نسمح لطلب واحد يعدي رغم إن
EWMA فوق العتبة. هذا الطلب يولّد sample جديد حقيقي، فلو Postgres رجع طبيعي،
EWMA تنخفض تدريجياً (بفعل الـ exponential weighting، alpha=0.2) والـ gate
يفتح تلقائياً بدون تدخل يدوي.
```

### سؤال 13: "كيف يشتغل الـ rollup accumulator؟ وكيف تضمنوا ما تضيع بيانات وقت الـ flush؟"

**الجواب:**
```
كل POST /logs لو كتب rollup delta مباشرة بقاعدة البيانات (INSERT/UPDATE على
logs_rollup_1m) كان يضيف DB round-trip إضافي على أهم مسار بالخدمة (insert
throughput) — وهذا بالضبط اللي بيحاول الـ backpressure يحميه. الحل
(rollup.ts): الـ delta يتجمّع بالذاكرة (Map<bucketMs, Map<service,
Map<level, count>>>) — تقريباً مجاني (بدون I/O)، وبينكتب دفعة واحدة كل
150ms (startRollupFlusher في index.ts) بمعدل ثابت مهما كان معدل الـ ingestion.

ضمان عدم ضياع بيانات وقت الـ flush:
1. flushRollup() يبدّل (swap) الـ Map القديمة بـ Map جديدة فاضية **قبل أي
   await** — فأي request جاي أثناء الـ flush بيتراكم بالـ Map الجديدة، مش
   بنفس الـ snapshot اللي عم ينكتب. ما فيه ضياع أو double-count.
2. لو الـ INSERT فشل (مثلاً rollupPool contention تحت حمل عالي)، الكود يدمج
   الـ snapshot يرجع جوا pendingRollup (merge، مش overwrite) — لأن ممكن
   تراكمت عليها deltas جديدة من requests صارت بعد الـ swap. لو كان overwrite
   بس، تلك الـ deltas الجديدة تضيع.
3. in-flight guard (startRollupFlusher): setInterval ما بيستنى الـ callback
   يخلص، فلو الـ flush أطول من الـ interval (rollupPool بس 2 اتصالات وممكن
   يزحم تحت حمل)، الـ ticks تتراكم بلا حدود. الـ guard يتخطى tick جديد لو
   فيه flush شغال — الـ tick اللي بعده (لما يخلص) يجمع كل شي تراكم، فما
   يضيع شي، بس يصير "coalesced" بدفعة واحدة.
```

### سؤال 14: "شو مشكلة 'minute boundary' بالـ rollup aggregate، وكيف انحلت؟"

**الجواب:**
```
logs_rollup_1m فيه صف واحد لكل دقيقة كاملة (bucket_start مضبوط على حدود
الدقيقة). لو المستخدم طلب since= لحظة عشوائية (مثلاً "آخر 30 ثانية" —
سيناريو read-after-write check شائع)، هذا since نادراً جداً يوقع بالضبط
على حدود دقيقة.

لو فلترنا bucket_start >= since مباشرة بدون تقريب، الدقيقة اللي since يقع
جواها تنرفض بالكامل من النتيجة — بما فيها الجزء اللي هو أصلاً داخل [since,
until) — يعني under-count يوصل لدقيقة كاملة من أحدث بيانات تقريباً بكل
استعلام.

الحل (aggregate.ts): نقرّب since لأسفل لحدود الدقيقة (`since - since %
MINUTE_MS`) قبل الفلترة SQL، وبرضو نستخدم نفس التقريب وقت دمج pendingRollup
(الـ deltas اللي لسا ما انكتبت بقاعدة البيانات، عبر mergePendingRollupIntoBuckets
في rollup.ts). الكلفة: أول bucket مرجوع ممكن يحتوي شوية بيانات من قبل الـ
since الحقيقي — خطأ أصغر بكثير من ضياع دقيقة كاملة شرعية.
```

### سؤال 15: "ليه حذفتوا idx_logs_level بالضبط، مع إنه كان يخدم فلتر شائع (level=error)؟"

**الجواب:**
```
level عنده بس 4 قيم ممكنة (debug/info/warn/error) — يعني index عليه
low-cardinality: كل batch insert بيتزاحم على نفس شوية صفحات btree (أقصى 4
"مجموعات" قيم) بدل ما ينتشر عبر الجدول. تحت concurrent inserts، هذا صار
المصدر الأساسي لـ LWLock contention على الـ single-core Postgres container.
القياس الفعلي (تعليق indexes.sql): 500-row insert صعد من 9ms لـ 21.5ms
بوجود هذا الـ index، وكان بيحدد سقف ingestion عند ~5-8k logs/sec بغض النظر
عن الحمل المعروض.

القرار: نضحي بسرعة استعلامات level-filtered (تصير تعتمد على
idx_logs_timestamp_id_desc + chunk exclusion + filter بعد الـ index scan،
مش index scan مباشر على level) عشان نحرر ingestion throughput (والـ CPU
headroom اللي يحرره لباقي الطلبات المتزامنة). trade-off واضح: الأولوية
لمسار الـ write لأنه الأكثر حساسية تحت هذا البنشمارك بالتحديد.

نفس المنطق طبّق على idx_logs_service: صار composite
idx_logs_service_ts_id (service, timestamp DESC, id DESC) بدل (service,
timestamp DESC) — service عنده cardinality أعلى بكثير من level (عشرات/
مئات الخدمات، مش 4)، فما عنده نفس مشكلة التزاحم، وإضافة id للـ index يخدم
الـ pagination (ORDER BY timestamp DESC, id DESC) مباشرة بدون Sort إضافي.
```

### سؤال 16: "ليه فيه 3 connection pools منفصلة (pool, queryPool, rollupPool) بدل واحد؟"

**الجواب:**
```
db/index.ts:
  pool       — max 10                              — insert + migration + retention
  queryPool  — max 8,  statement_timeout 8000ms     — GET /logs و GET /logs/aggregate
  rollupPool — max 2,  statement_timeout 5000ms     — كتابة flushRollup فقط

السبب: Postgres هنا محدود بـ 1 core، فالمشكلة مش عدد الاتصالات المتاحة —
المشكلة تزاحم الاتصالات (contention) بين أحمال ذات طابع مختلف تماماً:
  - استعلام aggregate بطيء (raw-scan fallback لو فيه attr/q بدون index) ممكن
    ياخذ اتصال لفترة طويلة ويخنق insertLogs، اللي هو المسار الأهم للـ SLA.
  - flushRollup مهمة صغيرة دورية (كل 150ms) — لو زاحمت نفس pool الـ insert،
    ممكن تتأخر inserts تحت الحمل العالي بدون داعي.

الحل: pools مخصصة بحدود صريحة تفصل أنواع الأحمال عن بعض. rollupPool محدود
بـ 2 اتصال بالتحديد لأنها مهمة صغيرة ومتكررة، ومش لازم تاخذ حصة أكبر من
موارد الـ core الوحيد. statement_timeout على queryPool/rollupPool يمنع
استعلام عالق (مثلاً aggregate بدون index مناسب) من التمسك باتصال للأبد.
```

### سؤال 17: "الـ named prepared statements (insert_logs, flush_rollup) — ليه بس هذولا الاثنين وليش مش query.ts/aggregate.ts؟"

**الجواب:**
```
insert_logs و flush_rollup نص الاستعلام عندهم ثابت 100% — بغض النظر عن حجم
الـ batch، النص نفسه (unnest على 5 أو 4 arrays). تسميتهم (name: "insert_logs")
يخلي Postgres يعمل parse/plan مرة واحدة فقط لكل physical connection، وبعدها
كل استدعاء لاحق على نفس الاتصال bind-and-execute بس — توفير CPU مباشر على
أكثر مسارين تكراراً بالخدمة.

query.ts (queryLogs) و aggregate.ts (queryAggregate) عندهم نص SQL ديناميكي —
عدد وترتيب شروط WHERE يتغير حسب الفلاتر المرسلة بكل request (service؟ level؟
attr.*؟ cursor؟ bucket؟). كل تركيبة فلاتر عملياً نص استعلام مختلف، فما فيه
"شكل ثابت واحد" تقدر تسميه statement واحد له. تسميتهم بيحتاج prepared-statement
cache على مستوى "shape" (LRU keyed بالـ SQL text نفسه، أو مكتبة مخصصة) —
تعقيد إضافي مقابل فايدة أقل، لأن query/aggregate مش المسار الحرج latency-wise
تحت هذا البنشمارك بالتحديد زي insert.
```

---

## 🎯 سيناريوهات عملية

### السيناريو 1: "أبغى أضيف rate limiting — شو تسوي؟"

أضيف middleware قبل POST /logs:
```typescript
// rateLimiter.ts
const requests = new Map<string, number[]>();
app.use((req, res, next) => {
  if (req.path === '/logs' && req.method === 'POST') {
    const ip = req.ip;
    const now = Date.now();
    const timestamps = requests.get(ip) || [];
    const recent = timestamps.filter(t => now - t < 1000); // آخر ثانية
    if (recent.length >= 100) return res.status(429).json({ error: "too many requests" });
    recent.push(now);
    requests.set(ip, recent);
  }
  next();
});
```

### السيناريو 2: "أبغى أضيف multi-tenancy (API keys)"

أضيف middleware:
```typescript
// جدول api_keys (tenant_id, key, name)
async function authenticateApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  const tenant = await pool.query('SELECT tenant_id FROM api_keys WHERE key = $1', [key]);
  if (!tenant.rows.length) return res.status(401).json({ error: "invalid api key" });
  req.tenantId = tenant.rows[0].tenant_id;
  next();
}
// كل query يضيف: WHERE tenant_id = $N
```

### السيناريو 3: "أبغى أضيف Redis cache للـ aggregate queries"

```
المشكلة: نفس الـ aggregate query يتكرر كل ثانية من الداشبورد.
الحل: خزّن النتيجة في Redis لمدة 5 ثواني.

async function queryAggregate(query) {
  const cacheKey = `agg:${JSON.stringify(query)}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);
  
  const result = await db.query(...);
  await redis.setex(cacheKey, 5, JSON.stringify(result));
  return result;
}
```

---

## 📌 أكثر جملة تثبت إنك فاهمة

> "أكبر تحدي في المشروع كان **الموازنة بين الأداء تحت الـ load والـ correctness** — مثلاً الـ partial acceptance يضمن ما نرفض batch كامل بسبب log واحد، والـ drop_chunks retention مع الـ cursor pagination يضمنوا الاستقرار تحت الـ load من غير ما يعلقوا الـ ingestion. كل decision أخذته كان جواب على هالمقايضة بين السرعة والدقة."

> "أحدث مثال على هالمقايضة: الـ backpressure بالـ ingest — بدل ما نضمن كل batch ينضاف مهما استنى، عم نقيس latency فعلي (EWMA) ولو تجاوز نص الـ SLA نرفض الـ batch فوراً (429) بدل ما نضيف طابور بيفشل أصلاً بعد فوات الأوان. ونفس الفلسفة بالـ rollup: بدل ما نكتب aggregate delta كل insert (تكلفة على المسار الحرج)، نجمعها بالذاكرة ونفلشها كل 150ms — سرعة القراءة (aggregate) مقابل حداثة البيانات بجزء من الثانية، مو أكثر."

> "لو رجعت للمشروع من جديد، أول شي أضيفه: **Redis cache للـ aggregate queries** (اللي فيها attr/q، لأنها الوحيدة اللي لسا بتعمل raw scan) — لأن الداشبورد يسوي نفس الطلب كل ثانية، وهذا يضغط على DB بدون سبب."
