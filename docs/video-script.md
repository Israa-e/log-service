# Final Project Video — Script & Recording Guide

**Goal:** ~5 minute video: architecture explanation + key decisions + live demo.
**Language:** Arabic narration (primary) or English narration — both scripts below.
**Estimated words:** ~750 (≈150 wpm).

To make sure the video covers the full project, the narration should explicitly mention:
- the core API: health, ingestion, querying, aggregation, pagination
- the database design: PostgreSQL + JSONB + TimescaleDB hypertable
- the retention and background jobs
- the dashboard UI pages: logs explorer, analytics, ingestion, retention, users, docs, and support
- the extra modules: authentication, alerts, notifications, and AI support chat
- the performance testing and the main bottlenecks/limitations

> **Note (verified against the codebase):** every claim below was checked against the actual
> source. Two facts to keep exact on camera:
> - The real `src/` layout is `routes/`, `controllers/`, `services/`, `db/` — validation lives
>   inside `services/logsService.ts` (`validateLogEntry`), there is no `validation/` folder.
> - The invalid-level rejection reason is reported exactly as `invalid level: 'critical'`.

---

# 🎥 النسخة العربية

## 🟢 0:00 – 0:25 — Introduction

### 👀 على الشاشة
افتحي **README.md** أو صفحة GitHub الرئيسية، وخلي اسم المشروع واضح.
إذا عندك VS Code، خلي الـ Explorer ظاهر وفيه structure المشروع.

### 🎤 احكي:
> Hi, I'm Israa, and this is my Log Ingestion and Query Service.
>
> الفكرة ببساطة هي بناء service شبيه بشكل مبسط بـ Datadog أو Grafana Loki.
> الـ applications تبعث logs للـ API، والـ service يخزنها في PostgreSQL، وبعدها بقدر أعمل
> search, filtering, pagination, and aggregation.
>
> المشروع مبني باستخدام Node.js, TypeScript, Express, PostgreSQL, TimescaleDB, and Docker.

**لا تدخلي بالتفاصيل هون.** فقط خلي الشخص يفهم: *شو المشروع وليش موجود.*

---

## 🟢 0:25 – 1:10 — Architecture

### 👀 شو تفتحي؟
في VS Code افتحي الـ Explorer وأظهري structure المشروع الفعلي:

```text
src/
├── routes/
├── controllers/
├── services/
├── db/
└── ...
```

بعدها افتحي **الـ main/server file** اللي فيه Express setup (`src/app.ts`) وابحثي عن:

```ts
app.use(...)
app.get('/health', ...)
app.post('/logs', ...)
app.get('/logs', ...)
app.get('/logs/aggregate', ...)
```

### 🎤 احكي:
> خليني أبدأ بالـ architecture.
> عندي Express كـ HTTP layer، وهو المسؤول عن استقبال الـ requests.
> بعدها الـ request بيمر على validation (موجودة ضمن الـ service layer، تحديداً في
> `logsService.ts`)، وبعدها service أو query-building layer، والـ database layer هو المسؤول
> عن تنفيذ SQL.
> أنا فصلت الـ HTTP logic عن الـ database logic، بحيث الـ route ما يكون مسؤول مباشرة عن بناء SQL.
>
> فالـ flow بشكل عام هو:
> **Client → Express → Validation → Service / Query Builder → PostgreSQL → Response.**
>
> وبالإضافة لذلك، عندي dashboard ويب مدمج يقدّم صفحات مثل logs explorer، analytics، ingestion,
> retention، users، docs، و support. هذه الصفحات محمية بـ session auth، بينما الـ API endpoints
> الأساسية تبقى مفتوحة حسب contract المطلوب.
>
> وعندي كمان background job مسؤول عن retention وحذف الـ old logs، بالإضافة إلى alert job
> و modules إضافية مثل notifications و AI support chat.

**⭐ هون نقطة مهمة:** مش لازم تفتحي كل ملف. أنتِ فقط بدك تثبتي إنك فاهمة architecture.

---

## 🟢 1:10 – 1:55 — Database + JSONB

### 👀 شو تفتحي؟
افتحي `src/db/schema.sql` وخلي هالجزء ظاهر:

```sql
CREATE TABLE logs (
  id SERIAL,
  timestamp TIMESTAMPTZ NOT NULL,
  level TEXT NOT NULL,
  service TEXT NOT NULL,
  message TEXT NOT NULL,
  attributes JSONB,
  PRIMARY KEY (id, timestamp)
);
```

ثم أظهري (من `src/db/migrate.ts`):

```sql
SELECT create_hypertable('logs', 'timestamp', if_not_exists => TRUE, migrate_data => TRUE);
```

### 🎤 احكي:
> هون عندي الـ main logs table.
> كل log عنده id و timestamp و level و service و message، بالإضافة إلى attributes.
> استخدمت TIMESTAMPTZ للـ timestamp لأن الـ logs ممكن تيجي من clients موجودين في time zones
> مختلفة، وأنا بدي أتعامل معها بشكل صحيح كوقت حقيقي.
>
> أهم design decision هون كانت attributes.
> استخدمت JSONB لأن الـ attributes مش ثابتة.
> مثلاً log ممكن يكون عنده user_id و region، وlog ثاني ممكن يكون عنده request_id و retries.
> فأنا ما بحتاج أعمل database migration كل مرة يظهر attribute جديد.
> الـ trade-off هو إن JSONB بيعطيني flexibility، لكن dynamic attributes أصعب في indexing.

### 👀 أثناء كلامك عن JSONB
افتحي مثال حقيقي من الـ data (Postman أو psql):

```json
"attributes": {
  "user_id": "42",
  "region": "eu-west",
  "retries": 3
}
```

هذا أقوى بصرياً من إنك تشرحي JSONB نظرياً.

---

## 🟢 1:55 – 2:30 — TimescaleDB + Indexes

### 👀 شو تفتحي؟
افتحي `src/db/indexes.sql`:

```sql
CREATE INDEX idx_logs_service ON logs (service, timestamp DESC);
CREATE INDEX idx_logs_level ON logs (level, timestamp DESC);
CREATE INDEX idx_logs_message_trgm ON logs USING GIN (message gin_trgm_ops);
```

### 🎤 احكي:
> استخدمت TimescaleDB لأن الـ logs بطبيعتها time-series data.
> حولت جدول logs إلى hypertable باستخدام timestamp.
> بدل ما يكون عندي table واحدة ضخمة، TimescaleDB بيدير البيانات على شكل time-based chunks.
>
> الميزة المهمة هون هي chunk exclusion.
> يعني إذا طلبت logs من آخر ساعة، database مش مضطرة تفحص كل البيانات الموجودة من الشهر الماضي،
> وإنما بتقدر تستبعد chunks اللي خارج الـ time range.
>
> بالنسبة للـ indexes، عملت indexes على service و level مع timestamp، لأنهم filters أساسية
> في الـ API.
> وكمان استخدمت trigram GIN index للبحث داخل message، لأن substring search مثل `payment` مش
> مناسب له B-tree index.

---

## 🟢 2:30 – 3:15 — Ingestion 🔥

هذا أهم جزء في الفيديو.

### 👀 شو تفتحي؟
افتحي `src/services/logsService.ts` — اللي فيه logic الـ `POST /logs`.
أظهري `validateLogEntry`، ثم انزلي مباشرة على كود الـ `unnest`:

```sql
INSERT INTO logs (timestamp, level, service, message, attributes)
SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::jsonb[])
```

### 🎤 احكي:
> الجزء الأهم بالنسبة إلي كان ingestion performance.
> الـ API دائماً يستقبل batch من logs.
> أول شيء بعمل validation لكل entry بشكل مستقل.
> يعني إذا عندي 500 logs وواحدة invalid، ما برفض الـ 500. بقبل الـ 499 الصحيحة وبرجع index
> وسبب الـ rejected entry.
>
> بعد الـ validation، بدل ما أعمل INSERT لكل log، بستخدم PostgreSQL unnest.
> الفكرة إني أرسل array لكل column، وبعدها PostgreSQL يحولهم إلى rows.
> هذا أفضل من إني أبني INSERT statement فيه placeholders لكل row.
> الـ SQL statement نفسه بيظل fixed-size حتى لو حجم الـ batch تغير.
>
> عملت benchmark على المشروع، ووصلت تقريباً إلى **15,100 إلى 17,700 logs per second**،
> وبالتالي تجاوزت الـ 15,000 المطلوبة.

**🔥 هون تحديداً:** افتحي الكود على `unnest`. لا تحكي فقط عنه. خلي interviewer يشوفه.

---

## 🟢 3:15 – 4:05 — Live Demo للـ API

هون بدك **توقفي عن VS Code وتروحي لـ Postman أو curl**. أنا أفضل **Postman** إذا مرتب عندك.

### 👀 أول شيء: `/health`
```http
GET /health
```
النتيجة: `200 OK`

> أولاً أتأكد إن الـ service جاهز من خلال health endpoint.
> هون الـ application ما بعتبر نفسه healthy إلا بعد ما يكون database connection جاهز
> والـ database setup خلص (المشروع بستنى الـ DB وبطبق الـ migrations قبل ما يبدأ يسمع).

### 👀 ثانياً: `POST /logs`
اعملي request فيه مثلاً 3 logs:

```json
{
  "logs": [
    {
      "timestamp": "2026-08-09T08:00:00Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": { "user_id": "42", "region": "eu-west" }
    },
    {
      "timestamp": "2026-08-09T08:01:00Z",
      "level": "info",
      "service": "auth",
      "message": "user logged in"
    },
    {
      "timestamp": "2026-08-09T08:02:00Z",
      "level": "critical",
      "service": "checkout",
      "message": "invalid level"
    }
  ]
}
```

النتيجة المتوقعة (exact):

```json
{
  "accepted": 2,
  "rejected": [
    { "index": 2, "reason": "invalid level: 'critical'" }
  ]
}
```

> هون بعمل ingestion حقيقي.
> عندي ثلاثة entries، واحدة منهم فيها invalid level (`critical` مش مسموح — المسموح هو
> `debug|info|warn|error`).
> لاحظوا إن الـ API ما رفض الـ whole batch.
> قبل الـ valid logs، ورفض فقط الـ invalid entry مع الـ index والسبب.

### 👀 ثالثاً: `GET /logs`
```text
GET /logs?service=checkout&level=error
```

> الآن بقدر أعمل query على الـ logs.
> مثلاً هون بفلتر حسب service و level.
> الـ filters ممكن تتجمع مع بعض، والـ SQL يتم بناؤه باستخدام parameterized queries، لذلك
> user input ما يتم إدخاله مباشرة داخل SQL.

### 👀 رابعاً: Pagination
إذا الـ response فيه `"next_cursor": "..."` اعمل request ثاني باستخدامه.

> الـ API يستخدم cursor-based pagination بدل OFFSET.
> الـ cursor يمثل آخر row في الصفحة الحالية باستخدام timestamp و id.
> وبالتالي الصفحة التالية تقدر تبدأ مباشرة من هذا المكان، بدل ما PostgreSQL تفحص وتخطي
> آلاف الـ rows مثل OFFSET.

### 👀 خامساً: Aggregate
```text
GET /logs/aggregate?since=...&until=...&bucket=5m&group_by=service
```

> وأخيراً عندي aggregation.
> هون أحدد time range و bucket size، مثلاً خمس دقائق، وأقدر أعمل grouping حسب service.
> TimescaleDB يستخدم time_bucket حتى يحول الـ timestamps إلى time buckets، وبعدها PostgreSQL
> يعمل COUNT لكل bucket.

### 👀 سادساً: Dashboard + Auth (إذا كان عندك وقت)
> وبما إن المشروع فيه واجهة ويب أيضاً، أقدر أفتح `http://localhost:8080` وأوضح إن عندي pages
> مثل logs explorer و analytics و ingestion و retention و users. هذه الصفحات تعتمد على session
> auth، بينما الـ API الأساسية تبقى متاحة كما هو مطلوب.

### 👀 سابعاً: Alerts / Notifications / Support (اختياري)
> وكمان عندي modules إضافية ل alerts، notifications، و AI support chat، وهي تعزز تجربة
> الـ dashboard لكن لا تغير contract الـ API الأساسي.

---

## 🟢 4:05 – 4:35 — Retention + EXPLAIN

هنا عندك **اختيار**. إذا عندك وقت، اعملي الاثنين بسرعة.

### 👀 Retention
افتحي `src/services/retentionService.ts` وأظهري:

```sql
SELECT drop_chunks('logs', older_than => $1::timestamptz)
```

> بالنسبة للـ retention، ما بعمل DELETE لملايين الـ rows واحدة واحدة.
> استخدمت TimescaleDB drop_chunks، بحيث يتم حذف الـ expired chunks كاملة.
> هذا يقلل الـ WAL والـ table bloat ويكون أفضل بكثير مع large datasets.

### 👀 EXPLAIN ANALYZE 🔥 (مهم جداً للـ interview)
إذا قدرتي، افتحي terminal أو PostgreSQL client وشغلي aggregation query مع `EXPLAIN ANALYZE`.
خلي الـ output ظاهر.

> وهون بقدر أتحقق إن الـ performance assumptions فعلاً صحيحة باستخدام EXPLAIN ANALYZE.
> أنا بهتم أشوف هل PostgreSQL يستخدم indexes، وهل TimescaleDB يعمل chunk exclusion، وكم
> execution time للـ query.
> هذا مهم لأنه بدل ما أفترض إن الـ query سريع، أنا فعلياً بقيّس الـ execution plan.

**إذا EXPLAIN مش جاهز عندك، لا تخاطري في الفيديو.** احذفي هذه الجزئية وخلي retention فقط.

---

## 🟢 4:35 – 5:00 — Bottleneck + Conclusion

### 👀 شو تفتحي؟
افتحي terminal وشغلي:

```bash
docker stats
```

وخليه ظاهر. هذا ممتاز جداً لأنك بتوريهم دليل الـ performance.

### 🎤 احكي:
> وأخيراً، عملت performance testing بدل ما أعتمد على assumptions.
> أثناء الـ load test، PostgreSQL وصل تقريباً إلى 95 إلى 100% من الـ CPU، بينما الـ application
> كان يستخدم أقل.
> هذا وضح لي إن الـ database هي الـ bottleneck، خصوصاً لأن الـ database container محدود بـ CPU واحد.
>
> عندي أيضاً بعض limitations، مثل dynamic attribute queries بدون time range، وارتفاع
> aggregation latency أحياناً أثناء ingestion.
>
> لو أكملت تطوير المشروع، أول improvements عندي ستكون continuous aggregates للـ aggregation،
> وbackpressure للـ ingestion.
>
> أهم lesson بالنسبة إلي من المشروع هو إن performance مش بس اختيار technology، وإنما فهم
> workload وقياس bottleneck.
> وأكبر optimization عملته كان استبدال per-row inserts بـ unnest batch inserts، وهذا هو
> اللي خلاني أتجاوز 15,000 logs per second.

---

## 🎯 ترتيب الشاشة النهائي

```text
0:00  GitHub / README
      ↓
0:20  VS Code → Project Structure
      ↓
0:45  VS Code → logs schema + TimescaleDB + indexes
      ↓
1:20  VS Code → POST /logs + unnest
      ↓
2:00  Postman → /health → POST /logs → GET /logs → GET /logs/aggregate
      ↓
2:50  Browser → dashboard pages (logs explorer / analytics / ingestion / retention / users)
      ↓
3:20  Quick mention → auth, alerts, notifications, support chat
      ↓
3:45  VS Code → retention job + drop_chunks
      ↓
4:15  Terminal → docker stats / performance evidence
      ↓
4:40  Conclusion + trade-offs
```

## ⭐ أهم نصيحة
**لا تحاولي تعرضي كل المشروع.** في 5 دقائق، الـ interviewer يريد يشوف أنك فاهمة **5 أشياء**:

1. **Architecture** → وين الـ request بروح؟
2. **Database design** → ليش PostgreSQL + JSONB + TimescaleDB؟
3. **Performance** → كيف وصلتي 15k+ logs/sec؟
4. **API demo** → أثبتي إن المشروع شغال.
5. **Trade-offs** → شو المشاكل اللي عرفتيها وكيف ممكن تحسنيها؟

وأقوى 3 أشياء لازم **تظهريها بالكود فعلياً** هي:

**`CREATE TABLE logs` → `create_hypertable` → `INSERT ... unnest`**

لأنهم بيثبتوا إنك مش بس بتستخدمي المشروع، بل فاهمة الـ design وراءه.

---

# 🎥 English Version

## 0:00 – 0:25 | Introduction + Problem

**Screen:** README.md / GitHub page, project name visible. VS Code Explorer with project structure.

**Narration:**
> Hi, I'm Israa, and this is my Log Ingestion and Query Service.
>
> The goal of this project is to build a simplified version of a log platform like Datadog
> or Grafana Loki. Applications send structured logs to the service, and the service stores
> them efficiently and allows clients to search, filter, paginate, and aggregate those logs.
>
> The main requirements were high-throughput ingestion, fast queries over around one million
> records, time-based aggregation, and configurable data retention.
>
> My implementation uses **Node.js, TypeScript, Express, PostgreSQL 16, TimescaleDB, and
> Docker Compose**.

---

## 0:25 – 1:15 | Architecture

**Screen:** VS Code Explorer showing the real structure (`routes/`, `controllers/`,
`services/`, `db/`), then `src/app.ts` with the Express setup and routes.

**Narration:**
> Let me start with the architecture. The application has a few main layers.
>
> At the top, I have the **Express HTTP layer**. The routes receive requests such as
> `POST /logs`, `GET /logs`, and `GET /logs/aggregate`. The request is then validated before
> it reaches the database layer.
>
> For queries, I separated the **query-building and persistence logic from the HTTP handlers**.
> This is important because the HTTP layer shouldn't be responsible for constructing SQL
> directly. The query builder takes the filters supplied by the client and creates a
> parameterized SQL query. Then the database layer executes that query using PostgreSQL.
>
> The database is PostgreSQL with TimescaleDB. There is also a background retention job that
> periodically removes expired data, plus an alert job and additional modules for
> notifications and AI support chat.
>
> On top of the API, I also serve a dashboard with pages such as logs explorer, analytics,
> ingestion, retention, users, docs, and support. The dashboard uses session-based auth,
> while the core API endpoints remain unauthenticated as required.
>
> So the overall flow is:
> **Client → Express → validation → service/query builder → PostgreSQL/TimescaleDB → response.**
>
> The whole system is containerized, so the expected setup is simply `docker compose up`.

---

## 1:15 – 2:00 | Database Design + Important Decisions

**Screen:** `src/db/schema.sql` with the `logs` table, then `create_hypertable`.

**Narration:**
> The main table is called `logs`. It contains `id`, `timestamp`, `level`, `service`,
> `message`, and `attributes`.
>
> I use `TIMESTAMPTZ` for the timestamp because logs are time-based and clients can send
> timestamps from different time zones.
>
> I use normal columns for `level`, `service`, and `message` because these fields have known
> query patterns.
>
> The interesting design decision is `attributes`. I chose **JSONB** because the attributes
> are arbitrary. For example, one log can have `{"user_id": "42", "region": "eu-west",
> "retries": 3}` and another log can have completely different attributes.
>
> With JSONB, I don't need a database migration every time a new attribute appears. I
> considered an EAV-style separate attribute table, but that would increase the number of
> rows and make ingestion and querying more complicated.
>
> The trade-off is that dynamic JSONB attributes are harder to index efficiently. So this
> design favors **ingestion simplicity and schema flexibility**, while accepting some
> limitations for arbitrary attribute queries.

---

## 2:00 – 2:40 | TimescaleDB + Indexes

**Screen:** `src/db/indexes.sql` — the composite indexes and the trigram GIN index.

**Narration:**
> I converted the `logs` table into a **TimescaleDB hypertable** using `timestamp` as the
> time dimension. A hypertable looks like one table to the application, but TimescaleDB
> internally divides it into time-based chunks.
>
> This gives me an important optimization called **chunk exclusion**. For example, if I query
> only the last hour, PostgreSQL can skip chunks that are outside that time range. That
> becomes very useful when the database contains around one million logs or more.
>
> For indexes, I created indexes aligned with the actual query patterns. I have indexes for
> `service plus timestamp`, `level plus timestamp`, and a **trigram GIN index** for message
> substring search. The trigram index is important because a normal B-tree index isn't
> suitable for arbitrary substring searches such as `q=payment`.
>
> I don't want to create indexes for every possible field because every additional index also
> makes writes more expensive.

---

## 2:40 – 3:25 | Ingestion + Performance

**Screen:** `src/services/logsService.ts` — `validateLogEntry`, then the `unnest` INSERT.

**Narration:**
> One of the most important parts of the project was ingestion performance. The requirement
> was at least **15,000 logs per second**.
>
> Instead of inserting every log individually, the API accepts a batch. Each entry is
> validated independently. So if a batch contains 500 logs and one is invalid, I don't reject
> the other 499.
>
> The valid entries are inserted using PostgreSQL's `unnest`. Instead of generating a huge
> query like `INSERT INTO logs VALUES ($1,$2,...), ($6,$7,...), ...`, I pass one array per
> column:
>
> ```sql
> INSERT INTO logs (timestamp, level, service, message, attributes)
> SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::jsonb[])
> ```
>
> This keeps the SQL statement itself fixed-size regardless of the batch size. This was the
> biggest ingestion optimization I found through benchmarking.
>
> With batches of 200 logs and 20 connections, I reached approximately **15,100 to 17,700
> logs per second**. With 500 logs and 8 connections, I reached approximately **17,200 to
> 17,600 logs per second**. So the implementation exceeded the required 15,000 logs per second.

---

## 3:25 – 4:10 | Live Demo — API

**Screen:** Postman or curl. Run each step slowly and narrate.

### `/health`
```http
GET /health
```
> The server only starts listening after the database is reachable and migrations have
> applied, so a 200 here means the whole system is ready.

### `POST /logs`
```json
{
  "logs": [
    { "timestamp": "2026-08-09T08:00:00Z", "level": "error", "service": "checkout", "message": "payment declined", "attributes": { "user_id": "42", "region": "eu-west" } },
    { "timestamp": "2026-08-09T08:01:00Z", "level": "info", "service": "auth", "message": "user logged in" },
    { "timestamp": "2026-08-09T08:02:00Z", "level": "critical", "service": "checkout", "message": "invalid level" }
  ]
}
```
Expected exact response:
```json
{ "accepted": 2, "rejected": [ { "index": 2, "reason": "invalid level: 'critical'" } ] }
```
> This demonstrates per-entry validation: the valid entries are accepted and only the invalid
> one is reported, with its index and reason, without failing the batch.

### `GET /logs`
```text
GET /logs?service=checkout&level=error
```
> Filters are freely combinable — service, level, time range, attribute equality, and message
> substring search. All queries are parameterized, so user input is never concatenated into SQL.

### Cursor pagination
> Every response includes an opaque `next_cursor` representing the last row's timestamp and
> id. The next request resumes exactly there instead of using OFFSET, which would make
> PostgreSQL scan and skip thousands of rows.

### `GET /logs/aggregate`
```text
GET /logs/aggregate?since=...&until=...&bucket=5m&group_by=service
```
> Here I specify a time range and a bucket such as `5m`. TimescaleDB's `time_bucket` groups
> the logs into five-minute intervals, optionally grouped by service or level.

### Dashboard + Auth (quick mention)
> I also built a browser-based dashboard with pages such as logs explorer, analytics,
> ingestion, retention, users, docs, and support. The dashboard uses session-based auth,
> while the core API endpoints remain unauthenticated as required.

### Alerts / Notifications / Support (optional)
> In addition, the project includes alerting, in-app notifications, and an AI support chat
> module. These are additive features and do not change the required API contract.

---

## 4:10 – 4:40 | Retention + Performance Evidence

**Screen:** `src/services/retentionService.ts` (`drop_chunks`), then `docker stats`.

**Narration:**
> For retention, I use TimescaleDB's chunk-based deletion. Instead of running a huge
> `DELETE FROM logs` against millions of rows, I use `drop_chunks`. This removes expired
> chunks efficiently and avoids the heavy row-by-row work and table bloat associated with
> massive deletes.
>
> I also measured the system under load. During ingestion, I monitored the containers using
> `docker stats`. The important finding was that PostgreSQL became the bottleneck. The
> database reached approximately 95–100% of its CPU limit, while the application used
> significantly less CPU.
>
> So the limiting factor wasn't Node.js. It was the one-CPU PostgreSQL container handling
> concurrent writes and aggregation queries.

---

## 4:40 – 5:00 | Conclusion + Trade-offs

**Narration:**
> There are a few known limitations. Dynamic attributes without a time range can require a
> larger scan because the attribute key is not known ahead of time. Aggregation latency can
> also increase during heavy ingestion because reads and writes compete for the same database
> CPU.
>
> If I continued developing the project, my next improvements would be continuous aggregates
> for precomputed aggregation results and explicit backpressure for ingestion.
>
> The most important lesson from this project was that I didn't just choose technologies — I
> measured the system and optimized the actual bottleneck.
>
> The biggest improvement was replacing per-row SQL generation with `unnest` batch inserts,
> which allowed the service to exceed the 15,000 logs-per-second requirement.

---

# Recording Guide (OBS)

### OBS Settings
| Setting | Value |
|---|---|
| Base/Output resolution | 1920x1080, 30 fps |
| Recording format | MP4 |
| Encoder | Hardware (NVENC) if available, else x264 "veryfast" |
| Audio | Microphone, 48 kHz, +10 dB gain test first |

### Scene layout (suggested)
- **Scene 1 — Intro:** README/GitHub page full-screen
- **Scene 2 — Terminal:** full-screen terminal window (Windows Terminal, dark theme)
- **Scene 3 — Code:** VS Code with the file open, font 18+
- **Scene 4 — Postman:** full-screen browser / Postman

### Pro tips
1. **Record in segments**, one per scene — cut between scenes in editing. Much easier than one
   perfect take.
2. **Fix the demo before recording**: run every request once first, so there are no surprises.
3. **Keep the mouse still** while talking; move it only when pointing at things.
4. **Pause 2–3 seconds** at the start of each segment before speaking (easy edit point).
5. Simple edits: CapCut / DaVinci Resolve (free) — just cut at pauses and add the title card.
6. **Speed check:** read the script aloud once with a timer — 750 words should land at ~5 min.

### Backup plan if something fails during the demo
- Health check 200, POST returns 400: check the JSON syntax in the terminal (paste from this
  file to avoid typos).
- Aggregate returns empty buckets: seed first — `npx tsx scripts/seed.ts`.
- Docker not running: open Docker Desktop and wait for "Engine running" before `docker compose up`.
