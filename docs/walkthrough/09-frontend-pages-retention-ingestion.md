## public/retention.html

This page is the operational dashboard for log retention. It shows live KPIs (total events, configured retention period, number of active services, and the timestamp/result of the last retention run), a 7-day log-volume bar chart, a per-log-level distribution breakdown, and a "Storage by Service" table with an estimated storage footprint per service over the last 24 hours. From here a user can trigger an on-demand retention sweep (`Run Retention`) or export the service storage table as a CSV (`Export CSV`); both buttons live in the side nav / top bar shared across pages.

### Document head (lines 1–17)

- Lines 1–2: standard `<!DOCTYPE html>` and `<html class="dark" lang="en">` — the page defaults to dark theme via the `dark` class (later toggled by `initTheme()`/`toggleTheme()` from `app.js`).
- Lines 3–6: charset, responsive viewport meta, and the tab title `Obsidian Log — Retention`.
- Line 7: loads the Tailwind CDN build with the `forms` and `container-queries` plugins.
- Line 8: `tailwind-config.js` — the project's shared Tailwind theme extension (custom color tokens like `surface`, `on-surface-variant`, `primary`, font tokens like `font-headline-md`, etc. used throughout).
- Lines 9–10: Google Fonts — Geist/JetBrains Mono for body/code text, and Material Symbols Outlined for icons.
- Line 11: loads ECharts 5.4.3 from cdnjs — used later for the log-volume bar chart.
- Line 12: shared `styles.css`.
- Lines 13–16: a scoped `<style>` block defining `.policy-card` hover transition (box-shadow/border-color animate over 0.2s, glow green on hover) — note the class is defined but not actually used on any element in this file's body (no `.policy-card` element appears below), so it's dead CSS carried over from a shared template.

### Side navigation (lines 18–38)

- Line 18: `<body class="flex min-h-screen">` — flex layout so the fixed sidebar and main content sit side by side.
- Lines 20–38: `<aside>` fixed to the left (`w-[240px] h-screen fixed left-0 top-0`), containing:
  - Lines 21–26: the brand block — a small green square icon (`layers` symbol), the "Obsidian Log" title, and a version string `v2.4.0-stable`.
  - Lines 27–31: the primary nav (`<nav>`) with links to `/logs-explorer` (Logs), `/analytics` (Metrics), and `/retention` (Retention). The Retention link (line 30) is styled as the active item (`text-secondary font-bold bg-surface-container-highest`) since this is the current page.
  - Lines 32–37: a bottom block with two action buttons and two more links:
    - `#add-log-btn` (line 33) — "Add Log" button; its click handler lives in the shared `app.js` (bound around line 919 there), not in this file's inline script.
    - `#run-retention-btn` (line 34) — "Run Retention" button; this page's inline script attaches the retention-run behavior to this id (see line 207 below).
    - Lines 35–36: `/docs` and `/support` links.

### Main content shell (lines 39–53)

- Line 40: `<main class="ml-[240px] flex-1 flex flex-col h-screen">` — offsets past the fixed sidebar.
- Lines 42–53: the top app bar (`<header>`), showing the current section label "Retention" (line 44) on the left, and on the right:
  - `#export-csv-btn` (line 47) — "Export CSV" button, wired up at line 233.
  - Line 49: a `logout()` icon button (global function in `app.js`).
  - Line 50: a `toggleTheme()` icon button with `id="theme-icon"` span that swaps the light/dark icon glyph.

### KPI cards (lines 54–78)

- Line 55: content wrapper `<div class="p-margin-safe space-y-6 overflow-auto flex-1">` — scrollable body area.
- Lines 57–78: a 4-column grid (`grid grid-cols-4 gap-gutter`) of KPI cards, each following the same template (label paragraph, big value paragraph, small caption paragraph):
  1. **TOTAL EVENTS** (lines 58–62) — value written to `#kpi-total`, caption `#kpi-total-range` (defaults to "all time" in markup, but the script overwrites it to "last 7 days").
  2. **RETENTION PERIOD** (lines 63–67) — `#kpi-retention-days`, hardcoded to `30` in markup and never updated by this page's script (it mirrors the `RETENTION_DAYS` env var, per the caption).
  3. **SERVICES** (lines 68–72) — `#kpi-services`, count of distinct services seen in the last 24h.
  4. **LAST RETENTION** (lines 73–77) — `#kpi-last-run` (defaults to "Never") and `#kpi-last-deleted` (deleted-count caption), both driven from `localStorage`.

### Volume chart + retention policy panel (lines 79–104)

- Line 80: `<div class="grid grid-cols-12 gap-6">` splits this row into an 8-column chart card and a 4-column policy card.
- Lines 81–87: the chart card. Line 83 is the header "Log Volume (7 days)" with a subtitle span `#volume-subtitle` (static text "by day", never changed by script). Line 86 is the empty container `#chart-volume` that ECharts mounts into.
- Lines 88–103: the "Retention Policy" card:
  - Lines 91–93: a static info block describing the default TTL, reading "Auto-delete logs older than `<span id="policy-days">30</span>` days", tagged "Active", with fixed target ("all services") and schedule ("every 60 min") — this is static copy, not populated by any fetch in this file.
  - Line 95: `#retention-status`, a hidden success banner (`hidden` class) containing `#retention-msg` — shown/hidden by the retention-run handler.
  - Lines 96–101: "DATA DISTRIBUTION" panel; its body `#level-distribution` (line 98) starts with a placeholder "Loading..." row and is replaced by the script with per-level bars.

### Service breakdown table (lines 105–117)

- Lines 106–110: card header "Storage by Service" with a static "Last 24 hours" label.
- Lines 111–116: a `<table>` with header row **Service / Events (24h) / % of Total / Est. Storage** (line 113) and a `<tbody id="service-table">` (line 115) that starts with a single "Loading..." row, later replaced with real rows by the script.

### Inline script (lines 120–247)

Line 120 loads the shared `app.js` (defines `initTheme`, `toggleTheme`, `logout`, `fetchJSON`, `downloadCSV`, the global `add-log-btn` handler, etc.) before the page-specific script runs.

- Line 122: `initTheme();` — applies the persisted/OS-preferred theme and fixes up the theme icon on load.
- Lines 123–124: two module-level state variables: `lastRunDeleted` (declared but never read/written again — dead variable) and `lastServiceBreakdown = []`, which caches the most recent per-service rows so the CSV export button can reuse them without re-fetching.

**`loadRetentionData()` (lines 126–204)** — the main data-loading routine:
- Lines 127–130: compute four ISO timestamps: `until` (now), `since7d` (7 days ago), `since24h` (24 hours ago), and `since1h` (1 hour ago, computed but never used below — dead variable).
- Lines 132–137: fire four aggregate queries in parallel via `Promise.all`, each calling `fetchJSON` (the `app.js` helper that GETs a URL and returns parsed JSON or `null` on failure) against `/logs/aggregate`:
  - `agg24h`: `since=since24h&until=until&bucket=1h` — hourly buckets for the last 24h (fetched but not directly used for a KPI/chart in this function; see below, it's not referenced after this point except implicitly not at all — this call's result `agg24h` is never read again in the function body).
  - `agg7d`: `since=since7d&until=until&bucket=1d` — daily buckets for the last 7 days, used for the "TOTAL EVENTS" KPI and the volume chart.
  - `svcAgg`: same 24h window with `group_by=service` — used for the "SERVICES" KPI and the service table.
  - `lvlAgg`: same 24h window with `group_by=level` — used for the level-distribution bars.
- Lines 140–142: `total7d` sums `count` across all `agg7d.buckets` (defaulting to `0` if the response or buckets are missing); writes the formatted number into `#kpi-total` and sets `#kpi-total-range` text to `'last 7 days'`.
- Lines 145–146: builds a `Set` of distinct `group` values from `svcAgg.buckets` (each bucket's `group` is a service name) and writes its `size` (or `'—'` if empty) into `#kpi-services`.
- Lines 149–154: reads `retention-last-run` and `retention-last-deleted` from `localStorage`. If a last-run timestamp exists, `#kpi-last-run` shows it formatted via `toLocaleString()`, and `#kpi-last-deleted` shows `"deleted N logs"` if a deleted count was stored.
- Lines 157–168 (volume chart): if `agg7d.buckets` is non-empty:
  - Line 158: `echarts.init(...)` on the `#chart-volume` div.
  - Lines 159–166: `setOption` config — transparent background, Geist font with color `#c5c6cb`; tooltip on axis trigger with dark styling; grid with fixed margins; x-axis is a category axis labeled with `toLocaleDateString()` of each bucket's `start`; y-axis is a value axis; a single bar series colored `#4edea3` with rounded top corners (`borderRadius:[4,4,0,0]`) and `barMaxWidth:40`, data = each bucket's `count`.
  - Line 167: registers a `window` `resize` listener that calls `c.resize()` so the chart stays responsive — note this listener is added again on every call to `loadRetentionData()` (i.e., every 30s refresh, see line 244), so it accumulates duplicate resize listeners over the page's lifetime (a minor listener leak).
- Lines 171–183 (level distribution): grabs `#level-distribution`. If `lvlAgg.buckets` has entries:
  - Line 173: a fixed color map for levels: `debug` gray `#8e9195`, `info` white, `warn` amber `#f59e0b`, `error` `#ffb4ab`.
  - Lines 174–175: `grps` accumulates total counts per level (defaulting unlabeled buckets to `'info'`).
  - Line 176: `total` = sum of all level counts.
  - Lines 177–180: builds one HTML block per level, sorted descending by count — each block shows the level name in its mapped color, the percentage (`toFixed(1)`) and raw count, plus a thin progress bar (`div` with `width:${pct}%` and matching background color) — then joins and injects into `innerHTML`.
  - Lines 181–183: else branch shows `"No data in last 24h"`.
- Lines 186–203 (service table): grabs `#service-table`. If `svcAgg.buckets` has entries:
  - Lines 188–189: `grps` sums counts per service (`group`), defaulting missing group to `'unknown'`.
  - Line 190: `total` = sum across services.
  - Line 191: `entries` = `[service, count]` pairs sorted descending by count.
  - Lines 192–196: maps entries into `lastServiceBreakdown` (the module-level cache used later for CSV export), computing `pct` (percentage of total, one decimal) and `storage` — an estimated KB figure computed as `count * 0.512`, explicitly commented as "~512 bytes per log" per-row estimate.
  - Lines 197–199: renders one `<tr>` per service (service name in bold primary color, formatted count, percentage, and `~{storage} KB`), replacing `tbody.innerHTML`.
  - Lines 200–203: else branch resets `lastServiceBreakdown = []` and shows a "No data in last 24h" row.

**Run Retention button handler (lines 207–231)** — click listener on `#run-retention-btn`:
- Lines 208–210: disables the button and swaps its label to a spinning `autorenew` icon with "Running...".
- Line 212: `POST /logs/retention/run` — triggers an on-demand retention sweep on the server.
- Line 213: parses the JSON response.
- Line 214: `deleted` = `data.deleted ?? 0`.
- Lines 215–218: shows the `#retention-status` banner with message `"Retention complete — deleted N logs."` in `#retention-msg`, unhiding it, then `setTimeout` re-hides it after 5 seconds.
- Lines 220–221: persists `retention-last-run` (current epoch ms as string) and `retention-last-deleted` (the deleted count) to `localStorage`, so the KPI card survives page reloads.
- Lines 222–223: immediately updates `#kpi-last-run` and `#kpi-last-deleted` in the DOM without waiting for the next `loadRetentionData()` cycle.
- Line 225: calls `loadRetentionData()` again to refresh all the charts/tables/KPIs immediately after the run.
- Lines 226–228: on error, logs to console (no user-facing error toast here).
- Lines 229–230: (outside the try/catch, so it always runs) re-enables the button and restores its original label/icon — note this happens synchronously right after the `await` chain resolves or throws, so the "Running..." state is visible only for the duration of the fetch/await.

**Export CSV button handler (lines 233–241)** — click listener on `#export-csv-btn`:
- Lines 234–237: if `lastServiceBreakdown` is empty, calls the optional global `window.showToast?.('No data to export', 'info')` and returns early.
- Line 238: maps the cached breakdown into row arrays `[service, count, "pct%", "storage KB"]`.
- Line 239: calls the shared `downloadCSV(filename, headers, rows)` helper (from `app.js`) with filename `retention-storage-<timestamp>.csv` and headers `['Service', 'Events (24h)', '% of Total', 'Est. Storage']` to trigger a browser download.
- Line 240: shows a success toast with the number of exported services.

**Initial load and polling (lines 243–244)**
- Line 243: `loadRetentionData();` — runs once immediately on page load.
- Line 244: `setInterval(loadRetentionData, 30000);` — refreshes all KPIs/chart/table every 30 seconds.

Lines 245–247 close the `<script>`, `<body>`, and `<html>` tags.

---

## public/ingestion.html

Despite the filename, this page's `<title>` and on-page content identify it as the **Settings** page (top bar label "Settings", tab title "Obsidian Log Engine — Settings") — it is a tabbed configuration screen with **General**, **Ingestion**, and **Storage** tabs, plus a row of live system-status cards (API health, retention days, total logs, DB latency). A user can edit cluster/timezone/retention settings, toggle ingestion batch-validation and adjust the max batch size, edit storage/DB pool settings, save or discard changes, and trigger an on-demand retention run — all settings persist to `localStorage` rather than any backend config endpoint.

### Document head (lines 1–13)

- Lines 1–2: `<!DOCTYPE html>` and `<html class="dark" lang="en">` opening directly into `<head>` (no line break, unlike retention.html).
- Lines 3–5: charset, viewport meta, title `Obsidian Log Engine — Settings`.
- Lines 6–7: Tailwind CDN (`forms`, `container-queries`) and shared `tailwind-config.js`.
- Lines 8–9: Geist/JetBrains Mono and Material Symbols fonts (no separate `styles.css` link and no ECharts include in this file — this page has no charts).
- Lines 10–13: inline `<style>`: sets default Material Symbols font-variation-settings (`FILL 0, wght 400, GRAD 0, opsz 24`) globally for the icon font, and a `.setting-card:hover` rule that tints the border green (`rgba(78,222,163,0.3)`) — this class *is* used throughout the body, unlike retention.html's unused `.policy-card`.

### Side navigation (lines 14–40)

- Line 14: `<body class="flex h-screen overflow-hidden">` (note: `overflow-hidden` on body, unlike retention.html's `overflow-auto` scroll area pattern — scrolling here happens on the inner content div instead, per line 63).
- Lines 16–40: `<aside>`, same fixed 240px sidebar pattern as retention.html:
  - Lines 17–23: brand block (logo, "Obsidian Log" title, version `v2.4.0-stable`) — laid out slightly differently (title and version stacked, not side by side).
  - Lines 24–28: nav links to `/logs-explorer`, `/analytics`, `/retention` — note none of these three is marked "active" (no highlighted class), even though the current page is the settings/ingestion page, which itself has no nav entry — this page is reached via a link elsewhere but has no sidebar self-link.
  - Line 30: `#add-log-btn` — same shared "Add Log" button as retention.html (handled globally in `app.js`).
  - Lines 32–33: `/docs` and `/support` links.
  - Lines 35–38: an admin identity block — a circular avatar with letter "A", "Admin Root" name, and "cluster-admin-01" subtitle — static markup, not populated by any fetch.

### Top app bar and notifications panel (lines 41–61)

- Lines 44–53: `<header>` with the "Settings" label on the left; on the right:
  - Line 49: `#notif-btn`, a bell icon button calling `toggleNotif()` (defined in `app.js`), with an `#notif-badge` red dot indicator (`hidden` by default).
  - Line 50: `logout()` button.
  - Line 51: `toggleTheme()` button with `#theme-icon`.
- Lines 55–61: `#notif-panel`, a hidden floating panel (`fixed right-4 top-16 ... hidden`) with a header ("Notifications" + "Mark all read" button calling `markAllNotifRead()`, both from `app.js`) and an empty `#notif-list` body populated elsewhere (in `app.js`, not this inline script).

### System status cards (lines 63–83)

- Line 63: `<div class="flex-1 overflow-auto p-panel-padding space-y-6">` — the scrollable main content area.
- Lines 66–83: `#status-cards`, a 4-column grid of live status tiles, all following the same card template (icon + label header, then a big value paragraph):
  1. **API Status** (lines 67–70) — icon `check_circle`, value target `#s-api-status`.
  2. **Retention Days** (lines 71–74) — icon `storage`, value target `#s-retention-days`.
  3. **Total Logs** (lines 75–78) — icon `database`, value target `#s-total-logs`.
  4. **DB Latency** (lines 79–82) — icon `speed`, value target `#s-db-latency`.
  All four start as `—` placeholders and are filled by `loadSystemStatus()` (line 231).

### Tab navigation (lines 85–90)

- Lines 86–90: three tab buttons with `data-tab` attributes (`general`, `ingestion`, `storage`), each calling `switchTab(name)` on click. The "General" button (line 87) starts visually active (`text-primary border-b-2 border-secondary`); the other two start dim (`text-on-surface-variant`).

### General tab (lines 92–110)

- `<section id="tab-general" class="space-y-6">` (visible by default, no `hidden` class).
- Lines 94–101: "General Configuration" card with three inputs in a 3-column grid: `#cfg-cluster-name` (text), `#cfg-region` (text), `#cfg-timezone` (a `<select>` with options UTC / America/New_York / America/Los_Angeles / Europe/London).
- Lines 102–109: "Retention Policy" card: `#cfg-retention-days` (number input, min 1 / max 365) and a `#run-retention-now` button ("Run Retention", wired at line 215), plus a static caption noting changes apply on the next hourly scheduled run.

### Ingestion tab (lines 112–121)

- `<section id="tab-ingestion" class="space-y-6 hidden">` (hidden until its tab is selected).
- Line 117: **Batch Validation** row — a label/description pair plus a toggle switch built from a hidden checkbox (`#cfg-batch-validation`, `class="sr-only peer"`) and a styled `<div>` that uses Tailwind's `peer-checked:` variants to visually render as an on/off switch (background turns `bg-secondary` and the knob translates right when checked).
- Line 118: **Max Batch Size** row — a range slider `#cfg-batch-size` (min 100, max 10000, default value 2500) with an inline `oninput` handler that live-updates the adjacent `#batch-size-val` span text to the slider's current value as the user drags it.

### Storage tab (lines 123–132)

- `<section id="tab-storage" class="space-y-6 hidden">`.
- Lines 128–129: "Storage & Database" card with two number inputs in a 2-column grid: `#cfg-max-pool` (Max Pool Connections) and `#cfg-timeout` (Statement Timeout in ms).

### Footer actions (lines 134–139)

- Line 136: `#discard-btn` — "Discard" button, wired at line 196.
- Line 137: `#save-btn` — "Save Settings" button, wired at line 201.

### Inline script (lines 141–263)

Line 141 loads shared `app.js` first.

**`switchTab(name)` (lines 145–153)** — tab-switching logic, invoked by the three tab buttons' `onclick` handlers:
- Lines 146–149: for every element with a `data-tab` attribute, strip the active classes (`text-primary`, `border-b-2`, `border-secondary`) and add the inactive class `text-on-surface-variant`.
- Line 150: re-add the active classes to the specific button matching `[data-tab="${name}"]`.
- Line 151: hide every element whose id starts with `tab-` (i.e., all three section panels), by adding `hidden`.
- Line 152: reveal the requested section by removing `hidden` from `#tab-${name}`.

**`DEFAULTS` object (lines 155–164)** — fallback settings used when nothing is stored yet: `clusterName: 'Cluster-01'`, `region: 'US-East-1'`, `timezone: 'UTC'`, `retentionDays: 30`, `batchValidation: true`, `batchSize: 2500`, `maxPool: 25`, `timeout: 30000`.

**`loadSettings()` (lines 166–179)**:
- Line 167: reads the `obsidian-settings` key from `localStorage`.
- Line 168: if present, merges the parsed JSON over `DEFAULTS` (`{...DEFAULTS, ...JSON.parse(saved)}`, so any missing keys in the saved object fall back to defaults); otherwise uses `DEFAULTS` directly.
- Lines 169–177: writes each value into its corresponding form control — `cfg-cluster-name`, `cfg-region`, `cfg-timezone` (`.value`), `cfg-retention-days` (`.value`), `cfg-batch-validation` (`.checked`), `cfg-batch-size` (`.value`) plus mirrors it into the `#batch-size-val` label text, `cfg-max-pool`, `cfg-timeout`.
- Line 178: returns the resolved settings object `s`.

**`getSettings()` (lines 181–192)** — the inverse of `loadSettings`: reads current values back out of each form control into a plain object, parsing numeric fields with `parseInt(...) || <default>` fallbacks for `retentionDays`, `batchSize`, `maxPool`, and `timeout`.

- Line 194: `loadSettings();` — populates the form immediately on page load.

**Discard button handler (lines 196–199)**: on click, calls `loadSettings()` again (re-reading from `localStorage`, discarding any in-form edits) and shows an info toast `"Settings reverted"` via `window.showToast?.(...)`.

**Save button handler (lines 201–213)**:
- Line 202: `getSettings()` reads the current form state.
- Line 203: `localStorage.setItem('obsidian-settings', JSON.stringify(s))` — persists it (this is the only place settings are actually saved back to storage; there is no server-side settings endpoint called here).
- Lines 204–207: disables the button and swaps its label to a spinning "Saving..." state.
- Lines 208–212: after a fixed 500ms `setTimeout` (a simulated save delay, not tied to any real async work), re-enables the button, restores its original label, and shows a success toast `"Settings saved"`.

**Run Retention Now button handler (lines 215–229)** — click listener on `#run-retention-now`:
- Lines 216–219: disables the button, shows a spinning "Running..." label.
- Line 221: `POST /logs/retention/run` — same endpoint used by retention.html's button.
- Lines 222–223: parses the response and shows a success toast `"Retention complete — deleted N logs"` (`data.deleted ?? 0`).
- Lines 224–225: on failure, shows an error toast `"Retention run failed"` (no console logging here, unlike retention.html's handler).
- Lines 227–228: unconditionally re-enables the button and restores its original HTML.

**`loadSystemStatus()` (lines 231–259)** — populates the four status cards:
- Lines 232–239: `fetch('/health')` (note: uses the raw `fetch`, not the `fetchJSON` helper, so `health` here is the `Response` object, not parsed JSON — `health.ok` is a legitimate `Response` property, so this check works correctly even though the JSON body is never read). If `health.ok` is truthy, `#s-api-status` shows "Healthy" in secondary (green) color, else "Down" in error (red) color. On a thrown exception (e.g., network failure), the catch block sets the text to "Unreachable" in error color.
- Lines 241–247: `fetchJSON('/logs?limit=1')` — fetches one log entry, primarily to read the `total` field (`logsRes?.total ?? 0`) off the paginated response, then writes the formatted total (or `'0'`) into `#s-total-logs`; on error, shows `'—'`.
- Lines 249–250: calls `getSettings()` to read the current in-form retention days value and writes `"{N} days"` into `#s-retention-days` — this reflects the *form's* current value, not a server-reported configuration.
- Lines 252–258: a manual latency probe — records `performance.now()` in `tStart`, does another `fetch('/health')` (a second, separate request from the one at line 233), and on success writes the rounded millisecond delta into `#s-db-latency`; on failure shows `'—'`. Despite the "DB Latency" label, this actually measures round-trip latency to the `/health` endpoint, not a direct database query.

- Line 261: `loadSystemStatus();` — runs once on page load. Unlike retention.html, there is no `setInterval` here — this page's status cards are not auto-refreshed after the initial load.

Lines 262–263 close the `<script>`, `<body>`, and `<html>` tags.
