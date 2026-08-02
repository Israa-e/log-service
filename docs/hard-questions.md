# أسئلة صعبة جداً — Advanced

السؤال اللي يخليك تثبت إنك فاهمة deep understanding.

---

## 🧠 الـ 10 أسئلة الأصعب

### سؤال 1: "ليه اخترتي `attributes @> '{"key": value}'::jsonb` وما استعملتي `->>` عادي؟"

هذا سؤال خبيث — بيختبر إذا فهمتي GIN index.

**الجواب:**
```
الـ @> يستخدم GIN index — وهذا index خاص بالـ JSONB بيفحص containment بسرعة.
أما `->>` تستخرج قيمة كنص — وما تستخدم GIN index أبداً.

يعني لو استعملت `attributes->>'key' = 'value'` — كان راح يمسح الـ table كامل (sequential scan).
أما @> فيستخدم GIN index ويرجع النتيجة بسرعة.

في logsService.ts سطر 170: attributes @> $${paramIndex}::jsonb
```

### سؤال 2: "في استعلام aggregate مع `bucket=1m` و `group_by=service` — شو بيصير لو في مليون صف؟ كيف تضمنين تحت 1 ثانية؟"

**الجواب:**
```
ثلاث عوامل تخليها سريعة:
1. time_bucket من TimescaleDB — يستخدم hypertable sorting على timestamp
2. الفلاتر تستخدم indexes:
   - service → idx_logs_service (السطر 2 في indexes.sql)
   - level → idx_logs_level (السطر 5)
   - attr.* → GIN idx_logs_attributes (السطر 8)
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
   
2. attr.region=eu-west → idx_logs_attributes (GIN on attributes)
   GIN index للـ JSONB containment check
   
3. q=declined → لا index
   message ILIKE '%declined%' — هذا Full Table Scan ضروري
   (PostgreSQL ما يدعم ILIKE index بدون extension)
   
الـ query planner بيقرر: يبدأ بـ index على service (الأكثر تحديداً)
ثم يطبق attr filter على النتائج، وأخيراً ILIKE.
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
   - attr.user.name → attributes @> '{"user": {"name": "value"}}'::jsonb
   - بس GIN index = دعم كامل لـ containment مهما كان العمق

التحدي:
- البساطة: الـ @> يشتغل مع أي عمق
- التعقيد: الـ load testing والخ properties

التغيير اللي أسويه:
- أشيل الـ validation اللي يمنع nested (السطور 65-74)
- الـ query builder ما يحتاج تغيير — @> يشتغل مع أي عمق
```

### سؤال 9: "عندي 10M logs ونظامك بطيء — شو أول 3 أشياء تفحصيها؟"

**الجواب:**
```
1. EXPLAIN ANALYZE
   أشوف هل الـ queries تستخدم indexes ولا لا.
   متوقع: Index Scan على service/level، Bitmap Scan على GIN

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
