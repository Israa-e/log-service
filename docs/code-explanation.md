# شرح الكود بالعربية - Obsidian Log Engine

**Obsidian Log Engine** هو نظام متكامل لإدارة وتحليل السجلات (Logs) مبني على Express.js + TimescaleDB + TailwindCSS. يسمح بإرسال السجلات، الاستعلام عنها، تحليلها إحصائياً، إدارة الاحتفاظ بها، وإشعارات التنبيهات.

---

## 1. هيكل المشروع (Project Structure)

```
log-service/
├── src/
│   ├── index.ts              # نقطة الدخول - تشغيل السيرفر والـ Migration
│   ├── app.ts                # إعداد Express والميدل وير والمسارات
│   ├── db/
│   │   ├── index.ts          # اتصال PostgreSQL pool
│   │   ├── schema.sql        # جداول قاعدة البيانات
│   │   ├── indexes.sql       # الفهارس (Indexes) لتحسين الأداء
│   │   └── migrate.ts        # تشغيل الـ Migration
│   ├── routes/
│   │   ├── logs.ts           # مسارات السجلات
│   │   ├── auth.ts           # مسارات المصادقة
│   │   ├── health.ts         # مسار فحص الصحة
│   │   ├── alerts.ts         # مسارات التنبيهات
│   │   ├── notifications.ts  # مسارات الإشعارات
│   │   └── support.ts        # مسار الدعم الفني
│   ├── controllers/
│   │   ├── logsController.ts # معالجات طلبات السجلات
│   │   ├── authController.ts # معالجات المصادقة
│   │   └── alertsController.ts # معالجات التنبيهات
│   └── services/
│       ├── logsService.ts    # منطق إدراج واستعلام السجلات
│       ├── retentionService.ts # خدمة حذف السجلات القديمة
│       ├── notificationService.ts # خدمة الإشعارات
│       ├── alertService.ts   # خدمة فحص التنبيهات
│       └── supportService.ts # خدمة الدعم عبر OpenRouter
├── public/
│   ├── app.js                # ملف JS مشترك لكل الصفحات
│   ├── index.html            # صفحة البداية - إعادة توجيه
│   ├── login.html            # صفحة تسجيل الدخول
│   ├── logs-explorer.html    # مستكشف السجلات
│   ├── analytics.html        # صفحة التحليلات
│   ├── retention.html        # صفحة الاحتفاظ بالسجلات
│   ├── ingestion.html        # صفحة الإعدادات
│   ├── dashboard.html        # لوحة التحكم
│   ├── styles.css            # ثيم الألوان والأنماط
│   └── tailwind-config.js    # إعدادات Tailwind CSS
├── docker-compose.yml        # إعداد Docker
├── Dockerfile                # بناء صورة Docker
├── package.json              # التبعيات
└── tsconfig.json             # إعدادات TypeScript
```

---

## 2. ملف الإعدادات والإقلاع (src/app.ts)

هذا الملف هو قلب تطبيق Express.js. يشرح كل سطر:

```typescript
import express from "express";
import session from "express-session";
```

- **express**: إطار العمل الأساسي لبناء REST API.
- **express-session**: ميدل وير لإدارة الجلسات (حفظ حالة تسجيل الدخول).

```typescript
import healthRouter from "./routes/health.js";
import logsRouter from "./routes/logs.js";
import { startRetentionJob } from "./services/retentionService.js";
import { startAlertJob } from "./services/alertService.js";
import alertsRouter from "./routes/alerts.js";
import notificationsRouter from "./routes/notifications.js";
import authRouter from "./routes/auth.js";
import supportRouter from "./routes/support.js";
import { checkAuth } from "./controllers/authController.js";
```

- **استيراد جميع المسارات والخدمات**: كل مسار موجود في ملف مستقل تحت `routes/`.
- **checkAuth**: دالة وسيطة (middleware) للتحقق من المصادقة قبل السماح بالوصول.

```typescript
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```

- **__dirname**: تحديد مسار المجلد الحالي (لأننا نستخدم ES Modules).

```typescript
const app = express();
app.use(express.json());
```

- **express.json()**: ميدل وير لتحليل body الطلبات بصيغة JSON - أساسي لاستقبال السجلات.

```typescript
app.use(
    session({
        secret: process.env.SESSION_SECRET || "dev-secret-change-me",
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 24 * 60 * 60 * 1000 },
    })
);
```

- **session**: تكوين الجلسات.
  - `secret`: مفتاح توقيع الكوكيز.
  - `resave: false`: لا تعيد حفظ الجلسة إذا لم تتغير.
  - `saveUninitialized: false`: لا تحفظ جلسة فارغة.
  - `maxAge`: صلاحية الجلسة 24 ساعة.

```typescript
const PUBLIC = path.join(process.cwd(), "public");
const authPage = (file: string) => (req: any, res: any) => {
  res.sendFile(path.join(PUBLIC, file));
};
```

- **authPage**: دالة مساعدة تنشئ middleware يرسل ملف HTML مع التحقق من المصادقة.

```typescript
app.get("/login.html", (req, res) => res.sendFile(path.join(PUBLIC, "login.html")));
app.get("/", (req, res) => res.redirect("/logs-explorer"));
app.get("/dashboard", (req, res) => res.redirect("/logs-explorer"));
```

- **"/login.html"**: صفحة الدخول متاحة للجميع (بدون مصادقة).
- **"/" و "/dashboard"**: يعيدان التوجيه إلى `/logs-explorer`.

```typescript
app.get("/logs-explorer", checkAuth, authPage("logs-explorer.html"));
app.get("/analytics", checkAuth, authPage("analytics.html"));
app.get("/ingestion", checkAuth, authPage("ingestion.html"));
app.get("/retention", checkAuth, authPage("retention.html"));
app.get("/history", checkAuth, authPage("retention.html"));
```

- **الصفحات المحمية**: كل صفحة تتطلب مصادقة عبر `checkAuth`. صفحة `/history` تؤدي لنفس صفحة `/retention`.

```typescript
app.get("/docs", (req, res) => res.sendFile(path.join(PUBLIC, "docs.html")));
app.get("/support", (req, res) => res.sendFile(path.join(PUBLIC, "support.html")));
```

- **صفحات عامة**: التوثيق والدعم الفني متاحان بدون مصادقة.

```typescript
app.use(express.static(PUBLIC));
```

- **الملفات الثابتة**: يخدم كل الملفات في `public/` مباشرة (CSS, JS, HTML).

```typescript
app.use("/health", healthRouter);
app.use("/logs", logsRouter);
app.use("/alerts", alertsRouter);
app.use("/auth", authRouter);
app.use("/notifications", notificationsRouter);
app.use("/support", supportRouter);
```

- **المسارات (Routers)**: ربط كل مسار بالـ Router الخاص به.

```typescript
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ error: "malformed JSON" });
  }
  next(err);
});
```

- **معالج أخطاء JSON**: ميدل وير من نوع error-handling (4 معاملات، وهو ما يجعل Express يتعرف عليه كمعالج أخطاء وليس middleware عادي). يُسجَّل بعد كل الـ routes، ويلتقط الخطأ الذي يرميه `express.json()` عندما يكون جسم الطلب JSON غير صحيح (malformed)، فيرجع استجابة نظيفة `400 { error: "malformed JSON" }` بدلاً من ترك Express يرجع صفحة خطأ افتراضية غير واضحة. أي خطأ آخر غير متعلق بتحليل JSON يُمرَّر عبر `next(err)`.

```typescript
startRetentionJob();
startAlertJob();
```

- **تشغيل الخدمات الخلفية**: عند بدء التشغيل، يبدأ عمل جدولة retention (مرة كل ساعة) وجدولة التنبيهات (كل دقيقة).

```typescript
export default app;
```

- **تصدير التطبيق** لاستخدامه في `src/index.ts`.

---

## 3. قاعدة البيانات (src/db/)

### src/db/index.ts - اتصال قاعدة البيانات

```typescript
import { Pool } from "pg";
export const pool = new Pool({
  user: "loguser",
  password: "logpass",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5433", 10),
  database: "logdb",
});
```

- **Pool**: اتصال متعدد (Connection Pool) بقاعدة PostgreSQL.
- **المتغيرات البيئية**: `DB_HOST` و `DB_PORT` يمكن تغييرها عبر البيئة.
- **المنفذ 5433**: المنفذ الخارجي لـ TimescaleDB في docker-compose (المنفذ الداخلي 5432).

### src/db/schema.sql - هيكل الجداول

ثلاثة جداول أساسية:

1. **logs**: جدول السجلات الرئيسي.
   - `id SERIAL`: معرف تلقائي.
   - `timestamp TIMESTAMPTZ NOT NULL`: الطابع الزمني للمسجلة.
   - `level TEXT NOT NULL`: مستوى السجل (debug, info, warn, error).
   - `service TEXT NOT NULL`: اسم الخدمة.
   - `message TEXT NOT NULL`: نص السجل.
   - `attributes JSONB`: سمات إضافية بصيغة JSON.
   - `PRIMARY KEY (id, timestamp)`: مفتاح رئيسي مركب (مطلوب لـ TimescaleDB hypertable).

2. **alert_rules**: قواعد التنبيهات.
   - `service TEXT`: الخدمة المستهدفة (null يعني كل الخدمات).
   - `threshold INT NOT NULL`: عتبة الأخطاء المسموح بها.
   - `window_minutes INT NOT NULL`: النافذة الزمنية بالدقائق.
   - `webhook_url TEXT NOT NULL`: رابط Webhook للإعلام.
   - `last_triggered_at TIMESTAMPTZ`: آخر مرة أُطلق فيها التنبيه (لمنع التكرار).

3. **notifications**: الإشعارات.
   - `type TEXT NOT NULL`: نوع الإشعار (alert, retention, system).
   - `title TEXT NOT NULL`, `message TEXT NOT NULL`.
   - `service TEXT`, `level TEXT`: معلومات إضافية.
   - `is_read BOOLEAN DEFAULT FALSE`: حالة القراءة.
   - `created_at TIMESTAMPTZ DEFAULT NOW()`: تاريخ الإنشاء.

### src/db/migrate.ts - تشغيل الترحيل

```typescript
export async function migrate(): Promise<void> {
  const schema = readFileSync(new URL("schema.sql", import.meta.url), "utf-8");
  await pool.query(schema);
  await pool.query(
    "SELECT create_hypertable('logs', 'timestamp', if_not_exists => TRUE, migrate_data => TRUE)"
  );
  const indexes = readFileSync(new URL("indexes.sql", import.meta.url), "utf-8");
  await pool.query(indexes);
  console.log("Migration complete");
}
```

- **قراءة ملفات SQL**: يقرأ schema.sql و indexes.sql من نفس المجلد.
- **إنشاء Hypertable**: يحول جدول `logs` إلى hypertable من TimescaleDB مقسم حسب `timestamp` - هذا هو أساس الأداء العالي.
- **إذا لم يكن موجوداً**: `if_not_exists => TRUE` يعني لا تفشل إذا كان موجوداً مسبقاً.

### src/db/indexes.sql - الفهارس

```sql
CREATE INDEX IF NOT EXISTS idx_logs_service ON logs (service, timestamp DESC);
```

- **فهرس service**: للفلترة السريعة حسب اسم الخدمة مع ترتيب زمني تنازلي. هام جداً لأن معظم الاستعلامات تبدأ بتحديد خدمة معينة.

```sql
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs (level, timestamp DESC);
```

- **فهرس level**: للفلترة حسب مستوى السجل (error, warn, etc). مع `timestamp DESC` لتحسين الترتيب.

```sql
DROP INDEX IF EXISTS idx_logs_attributes;
```

- **إسقاط فهرس attributes العام**: لأنه غير مفيد مع استخدام `->>` (النص يوضح السبب - مشغل `->>` لا يمكن فهرسته بسهولة).

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_logs_message_trgm ON logs USING GIN (message gin_trgm_ops);
```

- **pg_trgm**: إضافة PostgreSQL للبحث النصي المتقدم.
- **GIN index على message**: يسرع البحث بـ `ILIKE '%q%'` باستخدام Trigram.
- **TimescaleDB chunk exclusion**: يضمن أن الاستعلامات محدودة زمنياً (since/until) لا تفحص كل البيانات.

---

## 4. المسارات (Routes)

### src/routes/logs.ts - مسارات السجلات

```typescript
const router = Router();
router.post("/retention/run", async (req, res) => { ... });
router.post("/", createLogs);
router.get("/aggregate", aggregateLogs);
router.get("/", getLogs);
```

- **POST /retention/run**: تشغيل retention يدوياً - يستورد `runRetention` ديناميكياً وينفذها.
- **POST /": إدراج سجلات جديدة (يدعو `createLogs` من المتحكم).
- **GET /aggregate**: استعلام تجميعي (يدعو `aggregateLogs`).
- **GET /": استعلام سجلات مع فلترة (يدعو `getLogs`).

### src/routes/health.ts - فحص الصحة

```typescript
router.get("/", (req, res) => { res.status(200).send("OK"); });
```

- **GET /health**: بسيط - يعيد `OK` مع 200 للتحقق من أن السيرفر يعمل.

### src/routes/auth.ts - مسارات المصادقة

```typescript
router.post("/login", login);
router.post("/logout", logout);
router.get("/session", sessionStatus);
```

- **POST /auth/login**: تسجيل الدخول.
- **POST /auth/logout**: تسجيل الخروج.
- **GET /auth/session**: التحقق من حالة الجلسة الحالية.

### src/routes/alerts.ts - مسارات التنبيهات

```typescript
router.post("/", createAlert);
router.get("/list", listAlerts);
```

- **POST /alerts**: إنشاء قاعدة تنبيه جديدة.
- **GET /alerts/list**: عرض كل قواعد التنبيهات.

### src/routes/notifications.ts - مسارات الإشعارات

```typescript
router.get("/", async (_req, res) => { ... });     // GET /notifications
router.post("/read-all", async (_req, res) => { ... }); // POST /notifications/read-all
router.post("/:id/read", async (req, res) => { ... }); // POST /notifications/:id/read
```

- **GET /notifications**: جلب الإشعارات (مرتبة: غير مقروء أولاً، ثم الأحدث).
- **POST /notifications/read-all**: تعليم كل الإشعارات كمقروءة.
- **POST /notifications/:id/read**: تعليم إشعار محدد كمقروء (يتحقق من صحة id).

### src/routes/support.ts - مسار الدعم الفني

```typescript
router.post("/chat", async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) { res.status(400).json({ error: "message is required" }); return; }
  try {
    const reply = await getSupportReply(message);
    res.json({ reply });
  } catch (error: any) {
    console.error("Support chat error:", error.message);
    res.status(502).json({ error: "support agent unavailable" });
  }
});
```

- **POST /support/chat**: يأخذ رسالة من المستخدم، يرسلها إلى OpenRouter، ويعيد الرد.
- **التحقق**: يتأكد أن `message` موجودة ونصية.
- **502 Bad Gateway**: إذا فشل الاتصال بـ OpenRouter.

---

## 5. المتحكمات (Controllers)

### src/controllers/logsController.ts

ثلاث دوال معالجة:

**createLogs**:
- يتحقق من وجود `body.logs` كمصفوفة.
- يدعو `insertLogs` من الخدمة.
- يعيد `200` إذا قبل على الأقل سجل واحد، و`400` إذا رفض الكل.
- يعيد `500` مع `"internal server error"` لأي خطأ غير متوقع.

**getLogs**:
- يمرر `req.query` مباشرة إلى `queryLogs`.
- يعيد النتيجة كـ JSON.
- يمسك الأخطاء ويعيد `400` مع رسالة الخطأ (مثلاً "invalid level").

**aggregateLogs**:
- يمرر `req.query` إلى `queryAggregate`.
- نفس نمط معالجة الأخطاء.

### src/controllers/authController.ts

- **login**: يقارن كلمة المرور مع `DASHBOARD_PASSWORD` من البيئة. إذا تطابقت، يخزن `authenticated = true` في الجلسة.
- **logout**: يدمر الجلسة.
- **checkAuth**: ميدل وير - إذا `authenticated` موجود، يكمل، وإلا يعيد توجيه إلى `/login.html`.
- **sessionStatus**: يعيد `{ authenticated: true }` أو `401`.

### src/controllers/alertsController.ts

- **createAlert**: يدعو `createAlertRule` من الخدمة، يعيد `201`.
- **listAlerts**: يدعو `listAlertRules`، يعيد مصفوفة القواعد.

---

## 6. خدمات الخلفية (Services)

### src/services/logsService.ts

#### validateLogEntry - التحقق من صحة سجل واحد

فُصل التحقق من كل سجل إلى دالة مستقلة مُصدَّرة (`export function validateLogEntry`) بدلاً من أن يكون مدمجاً داخل `insertLogs`، لتصبح قابلة للاختبار بشكل منفصل (يوجد الآن ملف اختبار `src/services/logsService.test.ts`). تتحقق من:

1. **timestamp**: مطلوب ويجب أن يكون تاريخاً صحيحاً.
2. **الطابع الزمني في المستقبل**: يسمح بفارق 5 دقائق فقط للمستقبل (لمراعاة اختلاف التوقيت الطفيف).
3. **level**: يجب أن يكون واحداً من `["debug", "info", "warn", "error"]`.
4. **service**: نص غير فارغ.
5. **message**: نص غير فارغ.
6. **attributes**: إذا وجد، يتحقق من عدم وجود كائنات متداخلة (nested objects).

تعيد إما `{ valid: true, row: [...] }` (الصف جاهز للإدراج) أو `{ valid: false, reason }`.

#### insertLogs - إدراج السجلات بالجملة (bulk insert)

يستدعي `validateLogEntry` لكل سجل، ويجمع الصفوف الصحيحة في `validRows` والمرفوضة في `rejected`.

**الإدراج عبر unnest بدلاً من VALUES الديناميكي**: سابقاً كان الاستعلام يبني قائمة `placeholders` متغيرة الحجم (`VALUES ($1,$2,...), ($6,$7,...), ...`) تكبر مع حجم الدفعة. الآن يُبنى الاستعلام مرة واحدة بحجم ثابت:

```sql
INSERT INTO logs (timestamp, level, service, message, attributes)
SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::jsonb[])
```

- يُرسل مصفوفة واحدة لكل عمود (`timestamps[]`, `levels[]`, ...) بدلاً من N×5 معامل منفصل.
- بما أن نص الاستعلام ثابت الحجم بغض النظر عن عدد السجلات في الدفعة، لا يحتاج Postgres لإعادة تحليل/تخطيط استعلام متزايد الحجم في كل طلب. هذا كان أكبر تحسين على سرعة الإدخال (تم قياس ~15,000-17,700 سجل/ثانية).

**الإرجاع**: `{ accepted: N, rejected: [{ index, reason }] }`.

#### queryLogs - استعلام السجلات

بنية الاستعلام:

1. **تحقق من validity**:
   - `level`: إذا كان موجوداً، يتحقق من كل مستوى في الفاصلة المنفصلة.
   - `limit`: يُحوَّل لرقم، ويُرفض صراحة (برمي خطأ) إذا لم يكن عدداً صحيحاً أو كان خارج النطاق [1, 1000]، بدلاً من الاقتصاص الصامت.
   - `page`: يحول لرقم موجب (1-indexed)، يحسب `offset`.

2. **بناء الشروط (conditions)** ديناميكياً:
   - `service`: شرط مساواة.
   - `level`: يستخدم `ANY($N::text[])` لمقارنة مصفوفة.
   - `since/until`: شرط زمني مع تحقق من أن `until > since`.
   - `q`: `message ILIKE %q%` للبحث الجزئي (مستفيداً من فهرس trigram).
   - `attr.*`: أي مفتاح يبدأ بـ `attr.` يصبح `attributes ->> 'key' = value`.

3. **Cursor-based pagination**:
   - يدعم التصفح المتقدم عبر `cursor` (base64 مشفر لـ `{ timestamp, id }`).
   - فك التشفير محمي الآن بـ `try/catch` مع التحقق من شكل الكائن الناتج (`timestamp` نص و`id` رقم)؛ أي فشل أو شكل غير متوقع يرمي خطأ `"invalid cursor"` بدل أن يكسر الاستعلام.
   - إذا وُجد cursor، يستخدم `WHERE (timestamp, id) < ($N, $N+1)` بدلاً من `OFFSET`.

4. **استعلام COUNT(*) الاختياري**: يُنفَّذ فقط عندما لا يوجد `cursor` (أي فقط لواجهة الصفحات المرقمة في الداشبورد)، بدل تشغيله دائماً كما كان سابقاً. هذا يقلل تكلفة القراءة بمقدار النصف على المسار الأساسي (cursor pagination)، حيث `total` لا حاجة له هناك أصلاً.

5. **الإرجاع**: `{ logs, total, next_cursor }`.
   - `total`: `null` عند استخدام cursor، وإلا عدد السجلات المطابقة للفلتر.
   - `next_cursor`: إذا كان هناك صفحة تالية.

#### queryAggregate - الاستعلام التجميعي

**المعلمات المطلوبة**: `since`, `until`, `bucket`.

**أنواع الدلاء (buckets)**:
- `1m` → `1 minute`
- `5m` → `5 minutes`
- `1h` → `1 hour`
- `1d` → `1 day`

**group_by**: يمكن أن يكون `service` أو `level` أو null.

**الاستعلام الناتج**:
```sql
SELECT
  time_bucket('1 hour', timestamp) AS bucket_start,
  service AS group_value,  -- أو level أو NULL
  COUNT(*) AS count
FROM logs
WHERE timestamp >= $1 AND timestamp < $2 [AND ...]
GROUP BY bucket_start, service
ORDER BY bucket_start ASC
```

- **time_bucket**: دالة TimescaleDB التي تجمع السجلات في دلاء زمنية.
- **الإرجاع**: `{ buckets: [{ start, group, count }] }`.

### src/services/retentionService.ts - خدمة الاحتفاظ

**runRetention**:
- يحسب تاريخ القطع: `cutoff = الآن - RETENTION_DAYS`.
- يحسب أولاً `SELECT COUNT(*) FROM logs WHERE timestamp < $1` لأغراض التقرير/الإشعار فقط.
- ثم يحذف بنداء واحد لـ `SELECT drop_chunks('logs', older_than => cutoff)` بدلاً من الحذف صفاً صفاً على دفعات (batch DELETE بحلقة تكرار) كما كان سابقاً. هذه عملية على مستوى TimescaleDB hypertable تحذف "chunks" كاملة كعملية meta-data، مما يلغي الحمل على WAL/vacuum الناتج عن حذف ملايين الصفوف الفردية.
- **أثر جانبي مهم**: القطعة (chunk) لا تُحذف إلا إذا كانت **كاملة** أقدم من `cutoff`، فدقة الاحتفاظ الفعلية أصبحت بحدود مدة `chunk_time_interval` واحدة (7 أيام افتراضياً) بدل أن تكون دقيقة لليوم. لذلك قد يكون العدد المُبلَّغ عنه (من COUNT) أكبر قليلاً مما حُذف فعلياً.
- ينشئ إشعاراً بعدد السجلات المحذوفة إذا كان أكبر من صفر.

**startRetentionJob**:
- يشغل `runRetention` فوراً عند بدء التشغيل.
- ثم يكررها كل ساعة (60 دقيقة).

### src/services/notificationService.ts - خدمة الإشعارات

خمس دوال:

- **createNotification(type, title, message, service?, level?)**: إدراج إشعار جديد.
- **getNotifications(limit = 50)**: جلب الإشعارات مرتبة: الأقل قراءة أولاً، ثم الأحدث.
- **markAsRead(id)**: تعليم إشعار محدد كمقروء.
- **markAllAsRead()**: تعليم كل الإشعارات كمقروءة.
- **getUnreadCount()**: عدد الإشعارات غير المقروءة.

### src/services/alertService.ts - خدمة التنبيهات

**checkAlerts**:
- يجلب كل قواعد التنبيهات من `alert_rules`.
- لكل قاعدة يحسب عدد الأخطاء في النافذة الزمنية المحددة.
- إذا تجاوز العدد العتبة:
  - يتحقق من آخر مرة أُطلق فيها التنبيه (يمنع التكرار خلال 10 دقائق).
  - يرسل Webhook إلى URL المحدد مع بيانات التنبيه.
  - ينشئ إشعاراً في قاعدة البيانات.
  - يحدث `last_triggered_at`.

**startAlertJob**: يكرر `checkAlerts` كل دقيقة.

**createAlertRule**: إدراج قاعدة تنبيه جديدة مع التحقق من الحقول المطلوبة.

**listAlertRules**: جلب كل القواعد مرتبة تنازلياً حسب id.

### src/services/supportService.ts - خدمة الدعم عبر الذكاء الاصطناعي

**getDbContext()**:
- دالة جديدة تجلب إحصائيات حقيقية من قاعدة البيانات: إجمالي عدد السجلات، عدد الخدمات والمستويات المختلفة، أقدم وأحدث توقيت، وتوزيع آخر 24 ساعة حسب المستوى وحسب الخدمة (أعلى 8 خدمات).
- تعيد كل هذا كـ JSON نصي، أو النص `"Database context unavailable"` إذا فشل الاستعلام (محمية بـ try/catch).

**getSupportReply(message)**:
- يستخدم OpenRouter API (واجهة موحدة لمختلف نماذج الذكاء الاصطناعي).
- `SYSTEM_PROMPT`: يعرّف المساعد الذكي بأنه متخصص في Obsidian Log Engine، ويوضح أنه يجب استخدام سياق قاعدة البيانات المرفق للإجابة عن أسئلة تخص البيانات الفعلية.
- يستدعي `getDbContext()` ويضمّن نتيجتها مع رسالة المستخدم في محتوى رسالة الـ `user` المرسلة للنموذج، حتى يقدر الشات يجاوب على أسئلة عن البيانات الفعلية الحالية بدل إجابات عامة فقط.
- النموذج المستخدم: `gpt-4o-mini` (اقتصادي وسريع).
- `max_tokens: 300`: يحد طول الرد.
- يرسل `HTTP-Referer` و `X-Title` للتعريف بالتطبيق.
- **مهلة زمنية (timeout)**: يستخدم `AbortController` مع `setTimeout` مدته 15 ثانية حول طلب `fetch`، بحيث إذا لم يستجب OpenRouter لا يبقى الطلب معلقاً إلى الأبد؛ عند انتهاء المهلة يُرمى خطأ `"OpenRouter request timed out"`.
- في حال فشل الطلب (استجابة غير ناجحة)، يرمي خطأ مع كود الحالة ونص الاستجابة.

---

## 7. الواجهة الأمامية - الملف المشترك (public/app.js)

### **نظام الثيم (Theme System)**

**initTheme()**:
- يقرأ الثيم المحفوظ من `localStorage` (`obsidian-theme`).
- إذا لم يوجد، يستخدم `prefers-color-scheme` للمتصفح.
- يضيف/يزيل class `dark` أو `light` على عنصر `<html>`.
- يحدث أيقونة theme (قمر/شمس).

**toggleTheme()**:
- يبدل بين dark و light.
- يحفظ الاختيار في localStorage.
- يحدث الأيقونة.

### **API Utilities**

**fetchJSON(url)**: دالة مساعدة لجلب JSON من API. تعيد `null` في حال الفشل بدلاً من رمي خطأ.

### **CSV Export**

**downloadCSV(filename, headers, rows)**:
- يبني ملف CSV مع الهروب الصحيح للخلايا (يقتبس الخلايا التي تحتوي على فواصل أو أنصاف إقتباس أو أسطر جديدة).
- ينشئ عنصر `<a>` ويضغط عليه لتنزيل الملف.
- يستخدم `URL.createObjectURL` ثم `revokeObjectURL` للتنظيف.

### **Time Helpers**

- **ago(minutes)**: يعيد ISO string للوقت قبل `minutes` دقيقة.
- **formatTime(iso)**: تنسيق كامل للتاريخ.
- **formatTimeShort(iso)**: تنسيق الوقت فقط.

### **Level Helpers**

- **LEVEL_COLORS**: كائن يربط كل مستوى (error, warn, info, debug, success) بألوان الخلفية والنص والحدود.
- **levelBadge(lvl)**: يولد HTML لشارة المستوى (badge) مع ألوان مناسبة.
- **levelRowClass(lvl)**: يعيد class CSS للصف حسب المستوى.

### **Log Stream Renderer**

**renderLogRow(log)**: يعيد HTML لسجل واحد في اللوحة الحية (live feed).

### **Logout**

**logout()**: يرسل POST إلى `/auth/logout` ثم يعيد التوجيه إلى `/login.html`.

### **Drawer (الشريط الجانبي المنزلق)**

- **openDrawer(id)**: يزيل class `translate-x-full` ليظهر الشريط.
- **closeDrawer(id)**: يضيف class `translate-x-full` ليخفي الشريط.

### **Notifications System**

**loadNotifications()**:
- يجلب الإشعارات من `/notifications`.
- يحدث شارة (badge) الإشعارات (عدد غير المقروء).
- يعرض كل إشعار مع أيقونة حسب النوع (alert, retention, system).
- الإشعارات المقروءة تكون معتمة (opacity-60).

**toggleNotif()**: يظهر/يخفي لوحة الإشعارات ويحملها إذا ظهرت.

**إغلاق اللوحة عند الضغط خارجها**: مستمع حدث على `document` يخفي لوحة الإشعارات إذا ضغط المستخدم خارجها.

**markAllNotifRead()**: يرسل POST إلى `/notifications/read-all` ويحدث الواجهة.

### **الواجهات الديناميكية (IIFE - Immediately Invoked Function Expression)**

يستخدم نمط IIFE لتهيئة المكونات المشتركة:

**CSS المحقون (Injected CSS)**:
- Toast system: إشعارات منبثقة في أسفل اليمين.
- Drawer overlay: خلفية معتمة للشريط المنزلق.
- Custom drawer: شريط جانبي مخصص (500px).
- Support chat: واجهة الدردشة (فقاعات، حقل إدخال).
- Docs search and content: مربع بحث وقوائم قابلة للطي.
- Add Log Modal: نافذة منبثقة لإضافة سجل.

**Toast Function (showToast)**:
- ينشئ عنصر toast مع أيقونة ولون حسب النوع (success/error/info).
- يظهر بحركة انزلاق.
- يختفي بعد 4 ثوانٍ.

**Add Log Modal**:
- هيكل HTML ينشأ ديناميكياً.
- يحتوي على: level (select), service (input), message (input), attributes (textarea).
- التحقق من صحة المدخلات (service, message مطلوبان، attributes يجب أن يكون JSON صحيح).
- إرسال POST إلى `/logs` وعرض النتيجة.
- بعد النجاح، يستدعي `window.refreshLogsExplorer()` إذا كان موجوداً.

**Docs Drawer**:
- هيكل HTML مع sections قابلة للطي (accordion).
- البحث المباشر: أثناء الكتابة، يفلتر الأقسام ويوسع المطابقة تلقائياً.
- الضغط على رأس القسم يوسع/يطوي المحتوى.

**Support Drawer**:
- هيكل HTML لدردشة الذكاء الاصطناعي.
- appendChatBubble(text, isUser): إضافة فقاعة محادثة.
- handleSupportSend(): إرسال الرسالة، عرض مؤشر "جارٍ الكتابة"، استلام الرد.
- مستمعي الأحداث: زر Send وضغط Enter.
- الروابط في الشريط الجانبي: يربط أزرار Docs و Support بفتح الشريط المناسب.

**bindSidebar()**:
- يجد كل عناصر الشريط الجانبي.
- يربط أزرار Docs و Support بفتح الـ drawers المناسبة.
- يربط زر "Add Log" بفتح المودال.

---

## 8. صفحات الواجهة الأمامية

### logs-explorer.html - مستكشف السجلات

**الهيكل**:
- **Sidebar** يسار (240px): شعار Obsidian Log، روابط (Logs, Metrics, Retention)، زر Add Log، رابط Docs/Support، صورة المستخدم.
- **TopAppBar**: عنوان "Logs"، زر Export CSV، أزرار (خروج، ثيم، إشعارات).
- **لوحة الإشعارات**: قائمة منسدلة مع زر "Mark all read".
- **شريط الفلتر**:
  - حقل بحث مع أيقونة (بحث نصي في `q`).
  - زر النطاق الزمني (Time Range) مع قائمة منسدلة (15m, 1h, 6h, 24h, 7d, All time).
  - زر تشغيل (Play) لتطبيق الفلاتر.
  - اختيار الخدمة (Service) من قائمة منسدلة.
  - خانات اختيار المستوى (Level): INFO, WARN, ERROR, DEBUG.
- **جدول السجلات**: أعمدة TIMESTAMP, LEVEL, SERVICE, MESSAGE.
- **شريط التصفح السفلي**: يعرض عدد السجلات، الحالة الحية، أزرار التصفح (first, prev, pages, next, last).
- **Detail Drawer**: شريط جانبي يظهر تفاصيل السجل عند النقر عليه (المستوى، الخدمة، الرسالة، الوقت، السمات).

**المنطق (JavaScript)**:

- **SAMPLE_LOGS**: 25 سجل افتراضي للعرض التجريبي.
- **LEVEL_STYLES**: ألوان وأنماط لكل مستوى.
- **متغيرات الحالة**: `activeLevels` (Set), `selectedService`, `searchQuery`, `selectedRange`, `currentPage`, `limit = 25`.
- **TIME_RANGES**: مصفوفة خيارات النطاق الزمني.
- **renderLogs()**: الدالة الأساسية.
  - تبني `URLSearchParams` من الحالة الحالية.
  - تجلب البيانات من `/logs?params`.
  - تعرض الصفوف مع الألوان المناسبة والحدث `click` لفتح التفاصيل.
  - تحديث التصفح.
- **openDrawer(log, tr, i)**: يملأ شريط التفاصيل بمعلومات السجل (مستوى، خدمة، رسالة، طابع زمني، سمات).
- **updatePagination()**: يحسب عدد الصفحات، يعطل/يفعل أزرار first/last/prev/next، يبني أزرار الصفحات مع علامات الحذف.
- **التصفح المتقدم**: يعرض 5 صفحات فقط مع `...` للصفحات البعيدة.
- **مستمعي الأحداث**: 
  - أزرار التصفح (first, prev, next, last).
  - تغيير خانات المستوى (checkbox) - تحديث مباشر.
  - تغيير الخدمة (select) - تحديث مباشر.
  - إدخال البحث (input) - تحديث مباشر مع debounce طبيعي.
  - النطاق الزمني - قائمة منسدلة مع إغلاق عند الضغط خارجها.
  - زر Export CSV - يستخدم `downloadCSV` مع السجلات الحالية.
- **التحديث الدوري**: `loadNotifications()` كل 30 ثانية.

### analytics.html - صفحة التحليلات

**الهيكل**:
- **Sidebar**: مماثل لبقية الصفحات.
- **شريط الفلتر**: 
  - TIME RANGE: أزرار (1m, 5h, 1d).
  - GROUP BY: اختيار (Service, Level, None).
  - بحث لفلترة جدول التجميع.
  - زر REFRESH DATA.
- **مخطط Volume Trend (ECharts)**: خط زمني لحجم السجلات (خدمتين: API-Gateway و Auth-Service).
- **توزيع الأخطاء (Error Distribution)**: أشرطة تقدم (progress bars) لـ Critical Errors, Warnings, Info Logs, Debug Trace.
- **جدول Aggregation Summary**: خدمات وهمية مع أعداد، زمن استجابة، نسبة خطأ، حالة.

**المنطق**:
- **ALL_SERVICES**: 24 خدمة افتراضية مع بيانات إحصائية.
- **renderAggTable()**: يفلتر ويرتب ويعرض الجدول مع تصفّح (5 خدمات لكل صفحة).
- **`getFilteredServices()`**: يطبق الفلتر النصي والترتيب حسب `group_by`.
- **ECharts**: 
  - `echarts.init` لرسم المخطط.
  - `generateData()`: يولد بيانات محاكاة مع موجة جيبية (sin) وعشوائية.
  - خيارات المخطط: خطان سلسان (smooth line) مع تظليل (area fill) أسفل كل خط.
  - تصميم داكن مع ألوان متوافقة مع الثيم.
- **أزرار النطاق الزمني**: تحديث المخطط والشارة (badge).
- **زر REFRESH DATA**: حركة دوران (spin) ثم تحديث البيانات.
- **Anomaly Report**: يعيد التوجيه إلى `/logs-explorer?level=error`.

### retention.html - صفحة الاحتفاظ

**الهيكل**:
- **4 بطاقات KPI**: 
  - TOTAL EVENTS (من الـ API).
  - RETENTION PERIOD (عدد الأيام من البيئة).
  - SERVICES (عدد الخدمات الفريدة).
  - LAST RETENTION (آخر تشغيل من localStorage).
- **مخطط Log Volume (ECharts)**: أعمدة لآخر 7 أيام.
- **Retention Policy**: بطاقة TTL (30 يوم)، حالة التنفيذ، توزيع المستويات.
- **جدول Storage by Service**: اسم الخدمة، عدد الأحداث، النسبة المئوية، التخزين التقريبي.

**المنطق**:
- **loadRetentionData()**: يجلب 4 استعلامات متوازية (`Promise.all`):
  - `/logs/aggregate?bucket=1h&since=24h`: للتجميع الساعي.
  - `/logs/aggregate?bucket=1d&since=7d`: للتجميع اليومي.
  - `/logs/aggregate?group_by=service`: توزيع حسب الخدمة.
  - `/logs/aggregate?group_by=level`: توزيع حسب المستوى.
- **حساب الإحصائيات**: 
  - المجموع التجميعي لآخر 7 أيام.
  - مجموعة الخدمات الفريدة.
  - توزيع النسب المئوية للمستويات.
- **تخزين محلي**: يحفظ `retention-last-run` و `retention-last-deleted` في localStorage.
- **مخطط الحجم**: رسم بياني شريطي (bar chart) مع أعمدة خضراء.
- **زر Run Retention**: POST إلى `/logs/retention/run`، يظهر رسالة نجاح لمدة 5 ثوانٍ، يحدث البطاقات.
- **التحديث الدوري**: `loadRetentionData()` كل 30 ثانية.
- **حساب التخزين التقريبي**: `count * 0.512 KB` (تقدير 512 بايت لكل سجل).

### ingestion.html - صفحة الإعدادات

**الهيكل**:
- **بطاقات حالة النظام**:
  - API Status (Healthy/Down).
  - Retention Days (من الإعدادات).
  - Total Logs (من الـ API).
  - DB Latency (سرعة استجابة قاعدة البيانات).
- **Tabs**: General, Ingestion, Storage.
- **General Tab**: 
  - اسم الكتلة (Cluster Name).
  - المنطقة (Region).
  - المنطقة الزمنية (Timezone).
  - مدة الاحتفاظ (Retention Period) مع زر Run Retention.
- **Ingestion Tab**:
  - تفعيل/تعطيل التحقق من صحة الدفعة (Batch Validation).
  - حجم الدفعة الأقصى (Max Batch Size) - شريط تمرير.
- **Storage Tab**:
  - أقصى اتصالات Pool (Max Pool Connections).
  - مهلة الاستعلام (Statement Timeout).
- **أزرار الحفظ والتجاهل**: Save Settings و Discard.

**المنطق**:
- **switchTab(name)**: يبدل بين التبويبات (يغير class).
- **DEFAULTS**: القيم الافتراضية للإعدادات.
- **loadSettings()**: يقرأ من `localStorage.getItem('obsidian-settings')` ويملأ الحقول.
- **getSettings()**: يجمع القيم من الحقول ويعيد كائن.
- **Discard**: يعيد تحميل الإعدادات المحفوظة.
- **Save**: يحفظ في localStorage مع تأخير 500ms وهمي.
- **loadSystemStatus()**: 
  - يفحص `/health` لمعرفة حالة API.
  - يجلب `/logs?limit=1` لمعرفة العدد الكلي.
  - يقيس زمن استجابة `/health` (latency).
- **Run Retention**: POST إلى `/logs/retention/run` مع عرض Toast.

### dashboard.html - لوحة التحكم

**الهيكل**:
- **4 بطاقات**: Total Logs, Errors (1h), Services, Ingestion.
- **Live Log Stream**: تدفق مباشر للسجلات مع حقل استعلام.
- **Cluster Health**: 5 خدمات مع نسبة الصحة (health %).

**المنطق**:
- **loadMetrics()**: يجلب إحصائيات متعددة (total, errors, services rate).
- **loadLiveLogs()**: 
  - يقرأ الاستعلام من `#stream-query`.
  - يحلل الاستعلام إلى معلمات (service:, level:, أو نص عادي).
  - يعرض السجلات بتنسيق مضغوط.
- **loadClusterHealth()**: 
  - يجلب aggregation حسب الخدمة لآخر ساعة.
  - يحسب الصحة لكل خدمة (نسبة مئوية تقديرية).
  - يعرض أشرطة تقدم مع ألوان.
- **التحديث الدوري**: كل 10 ثوانٍ للـ metrics، كل 5 ثوانٍ للسجلات الحية، كل 30 ثانية للإشعارات.
- **نقطة حية (Live dot)**: وميض كل 1.5 ثانية.

### index.html - صفحة البداية

- صفحة HTML بسيطة جداً.
- عند التحميل، يرسل طلب `/auth/session`.
- إذا كانت الجلسة سليمة، يعيد التوجيه إلى `/logs-explorer`.
- إذا لم تكن سليمة، يعيد التوجيه إلى `/login.html`.

### login.html - صفحة تسجيل الدخول

**الهيكل**:
- بطاقة مركزية مع شعار Obsidian Log.
- حقل كلمة مرور واحد.
- زر Sign In.
- رسالة خطأ مخفية.

**المنطق**:
- **doLogin()**: 
  - يرسل POST إلى `/auth/login` مع كلمة المرور.
  - إذا نجح (200): يعيد التوجيه إلى `/logs-explorer`.
  - إذا فشل (401): يظهر رسالة "Wrong password".
- مستمع حدث `keypress` على حقل كلمة المرور (Enter = تسجيل دخول).
- تعطيل الزر أثناء الطلب لمنع التكرار.

---

## 9. إعدادات Tailwind (public/tailwind-config.js)

```javascript
tailwind.config = {
  darkMode: "class",
  theme: {
    extend: {
      colors: { /* ... */ },
      borderRadius: { DEFAULT: "0.125rem", lg: "0.25rem", xl: "0.5rem", full: "0.75rem" },
      spacing: { unit: "4px", gutter: "12px", "panel-padding": "16px", ... },
      fontFamily: { ... },
      fontSize: { ... },
    },
  },
}
```

**الألوان**: كل الألوان تُعرّف كـ CSS variables (`var(--background)`, `var(--primary)`, إلخ). هذا يسمح بالتبديل بين dark/light mode عبر تغيير المتغيرات في `styles.css`.

**المسافات (Spacing)**: تعريفات مخصصة مثل `panel-padding` (16px) و `gutter` (12px) و `margin-safe` (24px).

**الخطوط**: 
- Geist للنصوص الرئيسية (headline, body).
- JetBrains Mono للنصوص البرمجية (code).
- أحجام نص محددة مثل `code-sm` (12px) و `code-md` (13px).

---

## 10. Docker والنشر

### Dockerfile

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 8080
CMD ["npx", "tsx", "src/index.ts"]
```

- **node:20-alpine**: صورة خفيفة (حوالي 120MB).
- **npm ci**: تثبيت دقيق حسب `package-lock.json` (أسرع وأكثر أماناً من `npm install`).
- **tsx**: أداة تشغيل TypeScript مباشرة (no build step).
- **المنفذ 8080**: مكشوف للخارج.

### docker-compose.yml

**خدمتان**:

1. **app**: تطبيق Node.js.
   - يبني من الـ Dockerfile.
   - المنفذ `8080:8080`.
   - متغيرات البيئة: RETENTION_DAYS, DB_HOST, DB_PORT, DASHBOARD_PASSWORD, SESSION_SECRET, OPENAI_API_KEY.
   - `depends_on` مع `condition: service_healthy` - ينتظر حتى تكون قاعدة البيانات جاهزة.

2. **db**: TimescaleDB.
   - **timescale/timescaledb:latest-pg16**: صورة PostgreSQL مع إضافة TimescaleDB.
   - المستخدم: `loguser`، كلمة المرور: `logpass`، قاعدة البيانات: `logdb`.
   - المنفذ الخارجي `5433:5432` (لتجنب تعارض مع PostgreSQL محلي).
   - volume `pgdata` لحفظ البيانات.
   - **healthcheck**: يستخدم `pg_isready` كل 5 ثوانٍ للتأكد من أن قاعدة البيانات جاهزة.

### متغيرات البيئة الأساسية

| المتغير | الوصف | القيمة الافتراضية |
|---|---|---|
| `RETENTION_DAYS` | عدد أيام الاحتفاظ بالسجلات | `30` |
| `DB_HOST` | مضيف قاعدة البيانات | `localhost` |
| `DB_PORT` | منفذ قاعدة البيانات | `5433` |
| `DASHBOARD_PASSWORD` | كلمة مرور لوحة التحكم | `LogService2026!` |
| `SESSION_SECRET` | مفتاح توقيع الجلسات | مفتاح طويل |
| `OPENAI_API_KEY` | مفتاح OpenRouter للدعم الفني | (اختياري) |

### tsconfig.json - إعدادات TypeScript

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "target": "esnext",
    "strict": true,
    "sourceMap": true,
    "declaration": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

- **module: nodenext**: يدعم ES Modules مع Node.js (import/export).
- **target: esnext**: يستخدم أحدث ميزات JavaScript.
- **strict**: تفعيل كل خيارات التحقق الصارمة.
- **verbatimModuleSyntax**: يتطلب `import type` لأنواع TypeScript فقط.
- **skipLibCheck**: تخطي فحص ملفات التصريح (declaration files) لتسريع الترجمة.

---

## 11. هيكل قاعدة البيانات (indexes.sql) - شرح الفهارس

### `idx_logs_service ON logs (service, timestamp DESC)`

- **الهدف**: تسريع الفلترة حسب اسم الخدمة.
- **لماذا `timestamp DESC`؟**: لأن معظم الاستعلامات تعيد النتائج مرتبة تنازلياً (الأحدث أولاً). وجود `timestamp DESC` في الفهرس يجعل الترتيب مجانياً دون فرز إضافي.
- **سيناريو الاستخدام**: `SELECT * FROM logs WHERE service = 'auth-service' ORDER BY timestamp DESC LIMIT 25`.

### `idx_logs_level ON logs (level, timestamp DESC)`

- **الهدف**: تسريع الفلترة حسب مستوى السجل.
- **سيناريو الاستخدام**: `SELECT * FROM logs WHERE level = 'error' ORDER BY timestamp DESC`.
- **مفيد جداً لصفحة التحليلات** عند حساب عدد الأخطاء.

### `idx_logs_message_trgm ON logs USING GIN (message gin_trgm_ops)`

- **الهدف**: تسريع البحث النصي بـ `ILIKE '%q%'`.
- **pg_trgm**: إضافة تقسم النصوص إلى trigrams (ثلاثيات أحرف).
- **GIN index**: فهرس عكسي للبحث عن النصوص.
- **سيناريو الاستخدام**: `SELECT * FROM logs WHERE message ILIKE '%timeout%'`.
- **ملاحظة**: البحث بـ `%q%` (wildcard على الجانبين) لا يمكن تسريعه بفهرس B-tree العادي، لذلك استخدام trigram GIN index هو الحل الأمثل.

### لماذا لا يوجد فهرس على attributes؟

النص في `indexes.sql` يشرح أن:
- مشغل `->>` (استخراج نص JSON) لا يمكن فهرسته بفهرس GIN العام.
- `attributes ->> 'key'` يقارن كنص.
- بدلاً من فهرس غير فعال، يعتمد التصميم على "TimescaleDB chunk exclusion" - حيث أن كل استعلام يتطلب نطاقاً زمنياً (`since`/`until`)، يقوم TimescaleDB تلقائياً بتجاهل الـ chunks التي لا تقع في النطاق، مما يحد من حجم البيانات الممسوحة ضوئياً.

### `DROP INDEX IF EXISTS idx_logs_attributes`

- تمت إزالة فهرس attributes لأنه لم يكن مفيداً للأسباب المذكورة أعلاه.

---
