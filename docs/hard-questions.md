# أسئلة صعبة جداً — Advanced

السؤال اللي يخليك تثبت إنك فاهمة deep understanding.

---

## 🧠 الـ 10 أسئلة الأصعب

### سؤال 1: "ليه اخترتي `attributes ->> key = value` وما استعملتي `@>` مع GIN index؟"

هذا سؤال خبيث — بيختبر إذا فاهمة الفرق بين containment (`@>`) و key extraction (`->>`)،
ومتى الـ index يفيد فعلاً.

**الجواب:**
```
@> بيسرّعه GIN index — بس هذا الـ index بيفحص containment ("هل هالمستند يحوي هالقيمة")،
مش مقارنة key معين بقيمة معينة بشكل ديناميكي. والمشكلة الأكبر: attr.<key> جاي من query
string المستخدم — يعني الـ key نفسه ديناميكي بكل request. GIN على attributes بيسرّع
@> بس ما فيه طريقة تبني منه index ثابت لمفتاح متغير.

->> بترجع القيمة كنص وتقارنها مباشرة — مافيها index يسرّعها لأن نفس السبب (key ديناميكي)،
بس هي الاختيار الصح لأن الدلالة (semantics) المطلوبة بالـ spec هي مقارنة نصية بسيطة
(attribute values تتقارن كـ strings حتى لو كانت أصلها number/boolean).

فبدل ما نعتمد على index غير موجود، اعتمدنا على TimescaleDB chunk exclusion:
كل استعلام attr.<key> لازم يترافق مع since/until، فبوستجرس يستبعد الـ chunks الكاملة
اللي برا النطاق الزمني قبل ما يوصل لعمود attributes أصلاً — فالمسح الفعلي محدود
بالبيانات جوا النطاق الزمني، مش الجدول كامل.

في indexes.sql: `DROP INDEX IF EXISTS idx_logs_attributes` — الـ GIN القديم انحذف
عمداً لأنه كان بيفيد @> بس مش الاستعلام الفعلي (->>). وفي logsService.ts سطر 197:
`attributes ->> $${paramIndex} = $${paramIndex + 1}`
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

### سؤال 3: "إيش المشكلة لو سوت الـ retention DELETE مباشرة بدون batch؟"

**الجواب:**
```
بدون batch:
DELETE FROM logs WHERE timestamp < '2026-06-25'

هذا يساوي ملايين الصفوف دفعة واحدة — PostgreSQL يسأل Exclusive Lock على الجدول.
خلال هالوقت:
  - كل INSERT (POST /logs) يعلق
  - السيرفر يوقف استقبال logs
  - الـ load generator يشوف timeout → فشل

الحل (retentionService.ts):
DELETE في batches (1000 صف) — كل batch يأخذ lock قصير جداً.
بين الـ batches، الـ INSERTs العادية تشتغل طبيعي.
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

**الجواب:**
```
1. service=checkout → idx_logs_service (service, timestamp DESC)
   PostgreSQL بيسوي Index Scan على الأساس
   
2. attr.region=eu-west → مافيه index (اتحذف الـ GIN القديم)
   attributes ->> 'region' = 'eu-west' — بدون since/until هذا Sequential Scan
   على الجدول كامل (شوفي Known Limitations بالـ README — هاي بالضبط الحالة
   المحكية فيها)
   
3. q=declined → لا index (فقط idx_logs_message_trgm يخدم ILIKE، وما مستخدم هون
   إذا كانت query خفيفة، أو Bitmap Index Scan عليه لو استخدم)
   message ILIKE '%declined%'
   
الـ query planner بيقرر: يبدأ بـ Index Scan على service (الأكثر تحديداً)
ثم يطبق باقي الفلاتر (attr, q) كـ filter على النتائج بعد الفهرسة الأولى —
مافي index ثاني يستخدمه هون لأنه ما مرفق since/until.
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

> "أكبر تحدي في المشروع كان **الموازنة بين الأداء تحت الـ load والـ correctness** — مثلاً الـ partial acceptance يضمن ما نرفض batch كامل بسبب log واحد، والـ batch DELETE مع الـ cursor pagination يضمن الاستقرار تحت الـ load. كل decision أخذته كان جواب على هالمقايضة بين السرعة والدقة."

> "لو رجعت للمشروع من جديد، أول شي أضيفه: **Redis cache للـ aggregate queries** — لأن الداشبورد يسوي نفس الطلب كل ثانية، وهذا يضغط على DB بدون سبب."
