# شرح مشروع Lumina Logs — تحضير للمقابلة

---

## 1. إيش هو المشروع؟

مشروع **Log Ingestion & Query Service** — خدمة (backend server) بتستقبل وتخزن وتستعلم عن **سجلات (logs)** من تطبيقات مختلفة.
مثلاً عندك تطبيق خدمات (checkout, payment, auth) وكل خدمة بتنتج logs — هذا المشروع بيجمعهم بمكان واحد عشان تبحث فيهم وتحللهم.

اسم الداشبورد: **Lumina Logs**

---

## 2. الـ Tech Stack وليش اخترناهم؟

### Backend (السيرفر)
| التقنية | ليش؟ |
|---|---|
| **Node.js + TypeScript** | JavaScript مع type checking يمنع أخطاء وقت التشغيل |
| **Express 5** | أشهر web framework — بسيط ومرن |
| **PostgreSQL + TimescaleDB** | PostgreSQL العادي ما كان كفواً للأداء مع مرور الوقت. TimescaleDB بتضيف hypertable اللي بتقسم البيانات حسب الوقت تلقائياً — الاستعلامات تصير أسرع |
| **pg** | مكتبة توصيل Node مع PostgreSQL |

### Frontend (الداشبورد)
| التقنية | ليش؟ |
|---|---|
| **HTML + Tailwind CSS** | بدون React عشان البساطة — كل الصفحات static files تخدم من السيرفر مباشرة |
| **CSS Variables** | عشان الـ light/dark theme يشتغل بسلاسة |
| **ECharts** | رسوم بيانية متقدمة (أفضل من Chart.js) |
| **Material Symbols** | أيقونات |

### DevOps
| التقنية | ليش؟ |
|---|---|
| **Docker + Docker Compose** | يحزم السيرفر وقاعدة البيانات بحاويات — نفس البيئة في كل مكان |
| **GitHub Actions CI** | كل push يشغل automated testing |

---

## 3. هيكل المشروع (Architecture)

```
[Browser]  ──HTTP──>  [Express :8080]  ──SQL──>  [TimescaleDB]
                        │
                        └── يخدم static files (HTML, CSS, JS)
```

### Flow كاملة:
1. المتصفح يفتح صفحة HTML
2. الصفحة تسوي API calls للـ backend
3. الـ backend يستعلم من قاعدة البيانات
4. يرجع JSON → الداشبورد يعرض البيانات

### Startup Flow (ازاي السيرفر يشتغل):

```
src/index.ts
  │
  ├── waitForDb()          ← ينتظر قاعدة البيانات 60 ثانية
  │
  ├── migrate()            ← ينشئ الجداول + الفهارس + hypertable
  │
  ├── app.listen(8080)     ← السيرفر يبدأ
  │
  ├── Retention Job        ← يحذف logs القديمة كل ساعة
  │
  └── Alert Job            ← يفحص alert rules كل 60 ثانية
```

---

## 4. قاعدة البيانات (Database Schema)

### جدول logs — الرئيسي
| العمود | النوع | شرح |
|---|---|---|
| `id` | SERIAL | رقم تسلسلي |
| `timestamp` | TIMESTAMPTZ | وقت الـ log (عمود التقسيم) |
| `level` | TEXT | debug, info, warn, error |
| `service` | TEXT | اسم الخدمة (مثلاً checkout) |
| `message` | TEXT | نص الـ log |
| `attributes` | JSONB | خصائص اختيارية `{"userId":"abc"}` |

- **مفتاح أساسي مركب:** `(id, timestamp)` — ضروري لـ TimescaleDB
- **Hypertable:** يقسم البيانات حسب الوقت — الاستعلامات أسرع

### جدول alert_rules — قواعد التنبيهات
| العمود | النوع | شرح |
|---|---|---|
| `id` | SERIAL | رقم |
| `service` | TEXT | الخدمة المراقبة (nullable) |
| `threshold` | INT | عدد الأخطاء اللي تشغل التنبيه |
| `window_minutes` | INT | الفترة الزمنية |
| `webhook_url` | TEXT | رابط API يرسل إليه التنبيه |
| `last_triggered_at` | TIMESTAMPTZ | منع تكرار التنبيه |

### جدول notifications — الإشعارات (جديد)
| العمود | النوع | شرح |
|---|---|---|
| `id` | SERIAL | رقم |
| `type` | TEXT | alert, retention, system |
| `title` | TEXT | عنوان الإشعار |
| `message` | TEXT | التفاصيل |
| `service` | TEXT | الخدمة المعنية |
| `level` | TEXT | مستوى الخطأ |
| `is_read` | BOOLEAN | مقروء؟ |
| `created_at` | TIMESTAMPTZ | وقت الإنشاء |

### الفهارس (Indexes)
- `idx_logs_service` — B-tree على service, timestamp
- `idx_logs_level` — B-tree على level, timestamp
- `idx_logs_attributes` — GIN index للبحث في JSONB

---

## 5. API Endpoints بالتفصيل

### `GET /health`
يرجع `"OK"` — للتحقق أن السيرفر شغال.

### `POST /logs` — إدخال Logs
```
Body: { "logs": [{ "service": "checkout", "level": "error", "message": "Payment failed", "attributes": {"userId":"123"} }] }
```
- يقبل batch (مجموعة logs بنفس الطلب)
- **يتحقق من صحة كل log:**
  - **timestamp:** إذا ما في timestamp, بيستخدم الوقت الحالي تلقائياً
  - **level:** لازم يكون debug/info/warn/error
  - **service:** مطلوب
  - **message:** مطلوب
  - **attributes:** اختياري, ما يقبل nested objects
- **Partial acceptance:** بعض logs تنجح والبعض يُرفض مع سبب
- يرجع: `{ "accepted": 1, "rejected": [] }`

### `GET /logs` — البحث عن Logs
```
Query: ?service=checkout&level=error&since=...&until=...&q=payment&limit=50&cursor=base64...
```
- فلاتر: service, level, q (search in message), since/until (نطاق زمني)
- `attr.<key>` للبحث في attributes — يستخدم GIN index
- **Cursor pagination** (keyset pagination): أسرع من OFFSET لأنها تستخدم `WHERE (timestamp, id) < (?, ?)`
- يرجع: `{ "logs": [...], "next_cursor": "base64..." }`

### `GET /logs/aggregate` — إحصائيات
```
Query: ?since=...&until=...&bucket=1h&group_by=service
```
- يستخدم `time_bucket()` من TimescaleDB
- group_by: service أو level
- يرجع: `{ "buckets": [{ "start": "...", "group": "checkout", "count": 50 }] }`

### `POST /logs/retention/run` — حذف يدوي
- يحذف logs أقدم من `RETENTION_DAYS` (30 يوم)
- Batch delete: 1000 سجل كل مرة عشان ما يثقل السيرفر
- ينشئ notification بعد الإنجاز

### `POST /auth/login`
```
Body: { "password": "..." }
```
- يقارن مع `DASHBOARD_PASSWORD` (env var)
- ينشئ session إذا صح

### `POST /auth/logout` — يدمر الـ session

### `GET /auth/session` — يرجع `{ "authenticated": true/false }`

### `POST /alerts` — إنشاء قاعدة تنبيه
```
Body: { "service": "checkout", "threshold": 10, "window_minutes": 5, "webhook_url": "https://..." }
```

### `GET /alerts/list` — عرض كل القواعد

### `GET /notifications` — الـ Notifications
يرجع آخر 50 إشعار (غير مقروء أولاً).

### `POST /notifications/read-all` — يقرأ الكل

### `POST /notifications/:id/read` — يقرأ واحد

---

## 6. الـ Services Layer

### logsService.ts
| الفنكشن | الشرح |
|---|---|
| `insertLogs()` | يفحص كل log ويدخل الصحيح |
| `queryLogs()` | يبني SQL ديناميكي حسب الفلاتر + cursor pagination |
| `queryAggregate()` | time_bucket للتجميع الإحصائي |

> ملاحظة: `insertLogs()` صار يستخدم `unnest()` — إدراج بمصفوفات (عمود واحد لكل مصفوفة) بدل بناء قائمة placeholders تكبر مع حجم الدفعة. حسّن سرعة الإدخال بشكل كبير (تم قياس ~15,000-17,700 سجل/ثانية).

### alertService.ts
- `checkAlerts()`: يجري كل 60 ثانية
- لكل قاعدة: يحسب عدد errors في الفترة الزمنية
- إذا تجاوز threshold: يرسل Webhook + ينشئ notification + يسجل الوقت (منع تكرار آخر 10 دقايق)

### retentionService.ts
- `runRetention()`: بدل batch delete, صار يستخدم `SELECT drop_chunks('logs', older_than => cutoff)`
- استدعاء واحد يحذف "chunks" كاملة من الـ hypertable (عملية metadata سريعة) بدل حذف الصفوف على دفعات
- الفايدة: ما في حمل على WAL/vacuum يتناسب مع عدد الصفوف
- الكلفة: دقة الحذف صارت بحدود مدة chunk واحد (7 أيام افتراضياً) بدل دقة يومية
- ينشئ notification بعد ما يخلص

### notificationService.ts
- `createNotification(type, title, message, service?, level?)`
- `getNotifications(limit?)`
- `markAsRead(id)`, `markAllAsRead()`
- `getUnreadCount()`

---

## 7. لماذا اخترنا هذه التقنيات؟ (أسئلة مقابلة مهمة)

### ليش TimescaleDB مو PostgreSQL العادي؟
الـ logs كمية كبيرة جداً والاستعلامات تعتمد على الوقت. TimescaleBD يقسم الجدول حسب الوقت (hypertable) مما يخلي الحذف والبحث أسرع بكثير. لو استخدمنا PostgreSQL العادي، مع مليون سجل الاستعلامات كانت راح تصير بطيئة.

### ليش cursor pagination مو OFFSET؟
OFFSET يقرأ كل الصفوف ويرمي اللي ما يحتاج — بطيء جداً مع البيانات الكبيرة. Cursor يستخدم `WHERE (timestamp, id) < (?, ?)` ويستفيد من الفهارس — أسرع بكثير.

### ليش JSONB للأتريبيوتس؟
كل log ممكن يكون عنده خصائص مختلفة. JSONB يسمح بتخزين خصائص ديناميكية بدون تغيير schema. GIN index يخلي البحث فيهم سريع.

### ليش مو React للداشبورد؟
المشروع بسيط — dashboard بدون state management معقد. HTML + Tailwind أسرع في التطوير وأخف وزناً. كل الصفحات static files تخدم من السيرفر.

### إيش معنى partial acceptance؟
إذا أرسلت 10 logs و 8 صح و 2 غلط — الـ 8 ينحفظو والـ 2 يرجع سبب الرفض. السيرفر ما يرفض كل الطلب بسبب خطأ واحد.

### ليش express-session مو JWT؟
Dashboard بسيط مع مستخدم واحد. Session أسهل وأكثر أماناً لهذه الحالة.

### كيف اشتغل الـ Light Theme؟
كل الألوان معرفة كـ CSS variables. في `:root` ألوان light mode, وفي `.dark` ألوان dark mode. Tailwind config يستخدم `var(--name)` عشان الألوان تتغير تلقائياً حسب class.

### كيف اشتغل الـ Notifications؟
لما alert rule يتفعل (يتجاوز threshold) أو retention يخلص — السيرفر ينشئ سجل في جدول `notifications`. الداشبورد يسوي GET /notifications كل 30 ثانية ويظهر العدد على شكل badge.

---

## 8. تحسينات ممكن تسأل عنها

- **Rate limiting:** إضافة حد لعدد طلبات POST /logs
- **Authentication على API:** API keys للـ ingestion
- **Read replicas:** فصل قراءة وكتابة DB
- **Redis caching:** تسريع الاستعلامات المتكررة
- **Multi-tenancy:** دعم أكثر من مشروع
- **Structured logging:** تحويل رسائل الـ logs لنظام منظم
- **HTTPS:** تشفير الاتصال
- **Real-time websockets:** بدال polling كل 5-10 ثواني

---

## 9. CI/CD Pipeline

كل push على main:
1. `npm ci` — تثبيت الـ dependencies
2. `npm run build` — typecheck عبر `tsc --noEmit`
3. `npm test` — اختبارات وحدة عبر `tsx --test`
4. `docker compose up --build -d` — شغّل السيرفر + DB
5. انتظر `/health`
6. اختبر `POST /logs` (إدخال)
7. اختبر `GET /logs` (بحث)
8. اختبر `GET /logs/aggregate` (إحصائيات)

الفايدة: لو في خطأ نوع (type error) أو اختبار فاشل، الـ CI يفشل بسرعة قبل ما يشغل Docker أصلاً.

---

## 10. الـ Frontend — كل صفحة

| الصفحة | الرابط | إيش فيها |
|---|---|---|
| **Dashboard** | `/dashboard` | 4 metric cards, live log stream, cluster health, FAB for quick ingest |
| **Logs Explorer** | `/logs-explorer` | فلترة (service/level/message), جدول نتائج, detail drawer (نسخ JSON) |
| **Analytics** | `/analytics` | 4 ECharts: throughput, severity, top errors, services |
| **Ingestion Monitor** | `/ingestion` | Manual ingest form, rate/health metrics, ingestion chart |
| **Retention** | `/retention` | Storage timeline, Run Now, retention log |
| **Login** | `/login.html` | صفحة دخول بسيطة |

### المشترك بين الكل:
- **app.js:** Theme, fetchJSON, time/level helpers, logout, notifications
- **styles.css:** Glass cards, scrollbars, animations, CSS variables للـ theme
- **tailwind-config.js:** Custom colors (CSS variables), spacing, font tokens

---

## 11. Docker Setup

```
docker-compose.yml
├── app: port 8080, يعتمد على db
└── db: timescale/timescaledb:latest-pg16, port 5433, volume pgdata
```

### حدود الموارد (Resource Limits)
| الخدمة | الحد |
|---|---|
| `app` | `cpus: 0.5`, `mem_limit: 256m` |
| `db` | `cpus: 1`, `mem_limit: 1g` |

بالإضافة, قاعدة البيانات مضبوطة بإعدادات Postgres لتحسين الأداء تحت الحمل الكبير:
- `synchronous_commit=off`
- `shared_buffers=256MB`
- `max_wal_size=2GB`
- `checkpoint_completion_target=0.9`

هذا مقايضة: موثوقية كتابة أقل شوي (لو صار crash قبل الـ flush) مقابل زمن استجابة أقل.

### Environment Variables
| المتغير | الافتراضي | الاستخدام |
|---|---|---|
| `DB_HOST` | `localhost` | مكان DB |
| `DB_PORT` | `5433` | منفذ DB |
| `DASHBOARD_PASSWORD` | `LogService2026!` | كلمة سر الداشبورد |
| `SESSION_SECRET` | `dev-secret-change-me` | تشفير session |
| `RETENTION_DAYS` | `30` | بعد كم يوم تحذف logs |

---

## 12. خلاصة للمقابلة

> "هذا مشروع log ingestion service مبني على Node.js/Express مع TimescaleDB. استخدمنا TypeScript للـ type safety، Docker للتطوير والاختبار. الداشبورد مبني باستخدام Tailwind CSS مع CSS variables عشان الـ dark/light theme. أهم النقاط: batch ingestion للأداء، cursor pagination للتصفح، GIN index للبحث في JSONB، retention job للحذف الدوري مع notifications. المشروع يدعم partial acceptance للـ logs و webhook-based alerting مع نظام إشعارات متكامل."
