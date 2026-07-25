# شرح مشروع Log Ingestion Service — تحضير للمقابلة

## 1. إيش هو المشروع؟

مشروع **Log Ingestion & Query Service** هو خدمة (backend server) بتستقبل وتخزن وتستعلم عن **سجلات (logs)** من تطبيقات مختلفة. مثلاً عندك تطبيق خدمات (checkout, payment, auth) وكل خدمة بتنتج logs — هذا المشروع بيجمعهم بمكان واحد عشان تبحث فيهم وتحللهم.

اسم الداشبورد: **Lumina Logs**

---

## 2. الـ Tech Stack ليش اخترناهم؟

### Backend (السيرفر)
- **Node.js + TypeScript** — JavaScript لكن مع Type Checking (فحص الأخطاء قبل التشغيل)
- **Express 5** — الـ web framework الأكثر شهرة، بيساعد ننشئ API endpoints بسرعة
- **PostgreSQL + TimescaleDB** — PostgreSQL العادي ما كان كفواً عشان الأداء مع الوقت، TimescaleDB بتضيف hypertable اللي بتقسم البيانات حسب الوقت تلقائياً عشان الاستعلامات تكون أسرع
- **pg** — مكتبة لتوصيل Node.js مع PostgreSQL

### Frontend (الداشبورد)
- **HTML + Tailwind CSS** — تصميم بدون React عشان البساطة
- **ECharts** — مكتبة رسوم بيانية (لأن Chart.js ما كان كفاية)
- **Material Symbols** — أيقونات

### DevOps
- **Docker + Docker Compose** — يحزم السيرفر وقاعدة البيانات بحاويات منفصلة
- **GitHub Actions CI** — كل ما نعمل push للمشروع, بيشتغل automated testing

---

## 3. هيكل المشروع (Architecture)

```
[Client/Browser]  ──HTTP──>  [Express Server :8080]  ──SQL──>  [PostgreSQL + TimescaleDB]
       │                            │
       │                    ┌───────┴────────┐
       │                    │  Static Files   │
       └───────────────────>│  (public/ HTML, │
                            │   CSS, JS)      │
                            └────────────────┘
```

### Flow:
1. المتصفح يفتح الداشبورد (HTML + CSS + JS)
2. الداشبورد يسوي API calls للـ backend
3. الـ backend يستعلم من قاعدة البيانات ويرجع JSON
4. الداشبورد يعرض البيانات

---

## 4. كيف يبدأ السيرفر؟ (Startup Flow)

```
src/index.ts
  │
  ├── waitForDb()          ← ينتظر لين قاعدة البيانات تصبح جاهزة (poll كل ثانية لمدة 60 ثانية)
  │
  ├── migrate()            ← يشغل schema.sql (ينشئ الجداول)
  │                          يشغل indexes.sql (ينشئ الفهارس لتحسين الأداء)
  │                          يشغل create_hypertable (يقسم الجدول حسب الوقت)
  │
  ├── app.listen(8080)     ← السيرفر يبدأ يستقبل طلبات
  │
  ├── startRetentionJob()  ← مهمة خلفية تحذف الـ logs القديمة كل ساعة
  │
  └── startAlertJob()      ← مهمة خلفية تفحص alert rules كل 60 ثانية
```

---

## 5. قاعدة البيانات (Database Schema)

### جدول logs — الجدول الرئيسي

| العمود | النوع | شرح |
|---|---|---|
| `id` | SERIAL | رقم تسلسلي |
| `timestamp` | TIMESTAMPTZ | وقت حدوث الـ log (مهم جداً — هذا عمود التقسيم) |
| `level` | TEXT | debug, info, warn, error |
| `service` | TEXT | اسم الخدمة (مثلاً checkout) |
| `message` | TEXT | نص الـ log |
| `attributes` | JSONB | خصائص إضافية اختيارية (مثلاً `{"userId": "abc"}`) |

**مفتاح أساسي مركب:** `(id, timestamp)` — ضروري عشان TimescaleDB

**Hypertable:** الجدول مقسم حسب `timestamp` — هذا يعني البيانات الجديدة تروح لقسم خاص، البيانات القديمة بقسم آخر. هذا يخلي الاستعلامات أسرع بكثير.

### جدول alert_rules — قواعد التنبيهات

| العمود | النوع | شرح |
|---|---|---|
| `id` | SERIAL | رقم تسلسلي |
| `service` | TEXT | اسم الخدمة (nullable) |
| `threshold` | INT | الحد الأدنى لعدد الأخطاء |
| `window_minutes` | INT | الفترة الزمنية (بالدقائق) |
| `webhook_url` | TEXT | رابط API يُرسل إليه التنبيه |

### الفهارس (Indexes) لتحسين الأداء
- `idx_logs_service` — البحث السريع حسب الخدمة
- `idx_logs_level` — البحث السريع حسب مستوى الخطأ
- `idx_logs_attributes` — GIN index للبحث في JSONB

---

## 6. API Endpoints (نقاط النهاية)

### `GET /health`
- يرجع `"OK"` — يستخدم للتحقق أن السيرفر شغال

### `POST /logs` — إرسال Logs
```
Body: { "logs": [{ "service": "checkout", "level": "error", "message": "Payment failed", "attributes": {"userId":"123"} }] }
```
- يقبل batch (مجموعة logs في نفس الطلب)
- يتحقق من صحة كل log (timestamp موجود وصحيح, level مسموح, service مطلوب, message مطلوب, attributes مسطح)
- يقبل partial acceptance: بعض logs تنجح والبعض يُرفض مع سبب
- يرجع: `{ "accepted": 1, "rejected": [] }`

### `GET /logs` — البحث عن Logs
```
Query: ?service=checkout&level=error&since=...&until=...&q=payment&limit=50&cursor=base64...
```
- `service`, `level`, `q` (بحث في message), `since`, `until` (نطاق زمني)
- `attr.<key>` للبحث في attributes — يستخدم GIN index
- Pagination باستخدام **cursor** (keyset pagination) — أفضل من OFFSET لأنها أسرع مع البيانات الكبيرة
- يرجع: `{ "logs": [...], "next_cursor": "base64..." }`

### `GET /logs/aggregate` — إحصائيات
```
Query: ?since=...&until=...&bucket=1h&group_by=service
```
- يستخدم `time_bucket()` من TimescaleDB — يقسم logs حسب الفترة الزمنية
- `group_by`: service أو level — لمقارنة الخدمات
- يرجع: `{ "buckets": [{ "start": "...", "group": "checkout", "count": 50 }] }`

### `POST /logs/retention/run` — حذف يدوي
- يحذف logs أقدم من `RETENTION_DAYS` (30 يوم افتراضياً)
- يحذف batches: 1000 سجل كل مرة عشان ما يثقل السيرفر

### `POST /auth/login` — تسجيل الدخول
```
Body: { "password": "..." }
```
- يقارن كلمة السر مع `DASHBOARD_PASSWORD` (env var)
- ينشئ session إذا تطابقت

### `POST /auth/logout` — تسجيل الخروج
- يدمر الـ session

### `GET /auth/session` — التحقق من الجلسة
- يرجع `{ "authenticated": true/false }`

### `POST /alerts` — إنشاء قاعدة تنبيه
```
Body: { "service": "checkout", "threshold": 10, "window_minutes": 5, "webhook_url": "https://..." }
```

### `GET /alerts/list` — عرض قواعد التنبيه

---

## 7. الـ Services Layer (طبقة الخدمات)

### logsService.ts
- **insertLogs()**: يتحقق من كل log ويُدخل الصحيح في قاعدة البيانات
- **queryLogs()**: يبني استعلام SQL ديناميكي حسب الفلاتر
- **queryAggregate()**: يستخدم time_bucket للتجميع الإحصائي

### alertService.ts
- **checkAlerts()**: يجري كل 60 ثانية، يفحص count الأخطاء لكل قاعدة
- إذا تجاوز threshold: يرسل Webhook ويسجل التوقيت

### retentionService.ts
- **runRetention()**: يحذف logs القديمة في batches
- **startRetentionJob()**: يشغل المهمة كل ساعة

---

## 8. لماذا اخترنا هذه التقنيات؟ (أسئلة مقابلة)

### ليش TimescaleDB مو PostgreSQL العادي؟
الـ logs كمية كبيرة جداً والاستعلامات تعتمد على الوقت. TimescaleDB يقسم الجدول حسب الوقت (hypertable) مما يخلي الحذف والبحث أسرع بكثير. لو استخدمنا PostgreSQL العادي، مع مليون سجل الاستعلامات كانت راح تصبح بطيئة.

### ليش cursor pagination مو OFFSET؟
OFFSET يقرأ كل الصفوف ويرمي اللي ما يحتاج — مع البيانات الكبيرة هذا بطيء جداً. Cursor pagination يستخدم `WHERE (timestamp, id) < (?, ?)` ويستفيد من الفهارس.

### ليش JSONB للأتريبيوتس؟
لأن كل log ممكن يكون عنده خصائص مختلفة. JSONB يسمح بتخزين خصائص ديناميكية بدون تغيير schema. وأيضاً GIN index يخلي البحث فيها سريع.

### ليش مو React للداشبورد؟
المشروع needs simple dashboard بدون تعقيد React. HTML + Tailwind أسرع في التطوير وأخف وزناً. كل الصفحات static files تخدم من السيرفر مباشرة.

### إيش معنى partial acceptance؟
إذا أرسلت 10 logs و 8 صح و 2 غلط — الـ 8 ينحفظو والـ 2 يرجع سبب الرفض. السيرفر ما يرفض كل الطلب بسبب خطأ في سجل واحد.

### ليش express-session مو JWT؟
لأنه dashboard بسيط مع مستخدم واحد. Session أسهل وأكثر أماناً لهذه الحالة.

---

## 9. تحسينات ممكن أسأل عنها

- **Rate limiting**: إضافة حد لعدد الطلبات عشان منع abuse
- **Authentication على API**: إضافة API keys للـ ingestion endpoint
- **Read replicas**: فصل قراءة وكتابة قاعدة البيانات
- **Caching**: إضافة Redis لتسريع الاستعلامات المتكررة
- **Multiple tenants**: دعم أكثر من مشروع/عميل
- **Structured logging**: بدال ما نحط رسائل عادية، نحوي log بشكل منظم
- **Health checks متقدمة**: فحص PostgreSQL pool, disk space, response time

---

## 10. CI/CD Pipeline (GitHub Actions)

كل ما تسوي push عالـ main branch:
1. `docker compose up --build -d` — يشغل السيرفر وقاعدة البيانات
2. `wait for /health` — ينتظر السيرفر يشتغل
3. `POST /logs` — يختبر إدخال log
4. `GET /logs` — يختبر البحث
5. `GET /logs/aggregate` — يختبر الإحصائيات

---

## 11. Docker Setup

```
docker-compose.yml
├── app service
│   ├── builds from Dockerfile
│   ├── port 8080:8080
│   └── depends_on: db (health check)
│
└── db service
    ├── image: timescale/timescaledb:latest-pg16
    ├── port 5433:5432
    ├── volume: pgdata (persistent)
    └── health: pg_isready
```

لماذا Docker؟ عشان البيئة تكون نفسها في كل مكان: عندك وعند السيرفر. مع Docker ما في مشكلة "it works on my machine".

---

## 12. Environment Variables (متغيرات البيئة)

| المتغير | القيمة الافتراضية | الاستخدام |
|---|---|---|
| `DB_HOST` | `localhost` | مكان قاعدة البيانات |
| `DB_PORT` | `5433` | منفذ قاعدة البيانات |
| `DASHBOARD_PASSWORD` | `LogService2026!` | كلمة سر الداشبورد |
| `SESSION_SECRET` | `dev-secret-change-me` | تشفير session cookies |
| `RETENTION_DAYS` | `30` | بعد كم يوم تحذف logs القديمة |

---

## 13. الـ Frontend بالتفصيل

### Dashboard (`/dashboard`)
- 4 metric cards: Total Logs, Errors (1h), Services, Ingestion rate
- Live log stream بتحديث كل 5 ثواني
- Cluster health visualization
- Floating "+" button للإضافة السريعة

### Logs Explorer (`/logs-explorer`)
- فلاتر: service, level, search in message
- Pagination باستخدام Load More or cursor
- Detail drawer يظهر كل تفاصيل الـ log + نسخ JSON

### Analytics (`/analytics`)
- 4 رسوم بيانية: throughput (line), severity (pie), top errors (bar), services (bar)
- بتحديث كل 15 ثانية

### Ingestion Monitor (`/ingestion`)
- Manual ingest form
- System health indicators (CPU, Memory, Backpressure)
- Ingestion flow chart

### Retention (`/retention`)
- Storage timeline (hot, warm, cold, purge phases)
- "Run Now" button لبدء الحذف يدوياً

---

## خلاصة للـ Interview

قول: "هذا مشروع log ingestion service مبني على Node.js/Express مع TimescaleDB لتخزين logs بشكل scalable. استخدمنا TypeScript للـ type safety، Docker للتطوير والاختبار. الداشبورد مبني باستخدام Tailwind CSS و ECharts. أهم النقاط: batch ingestion للأداء، cursor pagination للتصفح، GIN index للبحث في JSON، retention job للحذف الدوري. المشروع يدعم partial acceptance للـ logs و webhook-based alerting."
