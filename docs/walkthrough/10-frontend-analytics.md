## public/analytics.html

This is a static HTML page (no build step, no framework) that renders the "Metrics" / analytics dashboard screen of Obsidian Log. It pulls in Tailwind via CDN, a custom Tailwind config, Google Fonts, and ECharts via CDN, then does all of its rendering and interactivity with a single inline `<script>` block plus a shared `app.js`. Nearly all of the data shown on this page — the chart series, the error-distribution bar values, and the aggregation table rows — is hardcoded or randomly generated in the browser; there is no `fetch()` call to a backend API anywhere in this file. That is called out explicitly in each relevant section below.

### Document head and page setup (lines 1–18)

- **Line 1–2**: `<!DOCTYPE html>` and `<html class="dark" lang="en">` — standard HTML5 doctype; the `dark` class on the root element is the hook Tailwind's `darkMode: 'class'` strategy (defined in `tailwind-config.js`) uses to apply dark-theme utility variants. The page loads dark by default.
- **Lines 3–5**: `<head>` opens, sets UTF-8 charset and a responsive viewport meta tag.
- **Line 6**: `<title>Obsidian Log — Metrics & Aggregation</title>` — browser tab title.
- **Line 7**: Loads the Tailwind CDN build with the `forms` and `container-queries` plugins enabled, so form controls (like the `<select>` on line 104) get Tailwind's form-reset styling and container-query utilities are available.
- **Line 8**: Loads `tailwind-config.js`, a sibling file that presumably defines the custom design tokens (`bg-surface`, `text-on-surface-variant`, `font-headline-md`, etc.) used throughout this page — these are not standard Tailwind classes, so this config is what makes them resolve.
- **Lines 9–10**: Two Google Fonts stylesheet links — "Geist" (400/600/700 weights) and "JetBrains Mono" (400/600) for the UI/monospace type pairing, and the "Material Symbols Outlined" variable icon font used for all the `<span class="material-symbols-outlined">` icons on the page.
- **Line 11**: Loads ECharts 5.4.3 from cdnjs. This is the only charting dependency; the volume chart later in the file is built entirely against the global `echarts` object this script exposes.
- **Line 12**: Local `styles.css` stylesheet (project-wide base styles, not shown in this file).
- **Lines 13–17**: An inline `<style>` block with three small utility classes not expressible via Tailwind alone:
  - `.status-chip` — the small monospace, uppercase, rounded pill used for service status badges in the aggregation table.
  - `.time-btn.active` — overrides background/color when a time-range button is toggled active (colors come from CSS custom properties `--secondary`/`--on-secondary`, presumably defined in `styles.css` or `tailwind-config.js`).
  - `.table-row:hover` — hover background for aggregation table rows.
- **Line 18**: `</head>` closes; `<body class="flex min-h-screen">` opens the body as a flex container so the fixed sidebar and the main content area sit side by side.

### Sidebar navigation (lines 21–63)

This is the same left `<aside>` pattern used across the dashboard's other pages.

- **Line 22**: `<aside>` is `w-[240px]`, `fixed left-0 top-0`, full height, with a right border — it's pinned to the viewport independent of scrolling in the main content.
- **Lines 23–33**: Brand block — a small primary-colored square with a "layers" Material icon, the "Obsidian Log" wordmark, and a version string `v2.4.0-stable` (a static label, not derived from any package/version data).
- **Lines 34–44**: The `<nav>` with three links: `/logs-explorer` ("Logs"), `/analytics` ("Metrics"), `/retention` ("Retention"). The `/analytics` link (lines 38–40) is styled differently from its siblings — `text-secondary font-bold bg-surface-container-highest` and a filled ("FILL 1") icon variation — to indicate this is the current page. This is done purely via hardcoded classes in the markup, not by JS that reads `location.pathname`.
- **Lines 45–62**: Footer block of the sidebar:
  - Line 46–48: an "Add Log" button (`id="add-log-btn"`) — note that no listener is attached to this id anywhere in this file's inline script, so its behavior (if any) must come from the externally loaded `app.js`.
  - Lines 49–54: "Docs" and "Support" links.
  - Lines 55–61: A static user chip showing an avatar with the letter "A", the label "Admin User", and "PREMIUM NODE" — hardcoded placeholder identity, not populated from a session/auth call.

### Header bar (lines 66–79)

- **Line 66**: `<main class="ml-[240px] ...">` — the main content area is offset by the sidebar's fixed width and takes the remaining flex space, scrolling internally (`h-screen` + later `overflow-auto` on the content div).
- **Line 68**: `<header>` — sticky top bar (`sticky top-0 z-40`) so it stays visible while the content below scrolls.
- **Line 70**: Static "Metrics" label on the left, confirming the section context.
- **Lines 73–77**: Three icon buttons on the right:
  - Line 74: Logout button with inline `onclick="logout()"` — this calls a global `logout()` function that must be defined in `app.js` (not in this file).
  - Line 75: Theme toggle with `onclick="toggleTheme()"` and an icon span `id="theme-icon"` (initial icon `light_mode`) — again, `toggleTheme()` is defined externally in `app.js`.
  - Line 76: Notification bell with `onclick="toggleNotif()"` and a small red dot badge (`id="notif-badge"`, currently `hidden`) that would presumably be un-hidden by external logic when there are unread notifications.

### Notifications panel (lines 82–88)

A hidden-by-default (`class="hidden"`) floating panel (`id="notif-panel"`) positioned under the header. It has a header row with a "Mark all read" button (`onclick="markAllNotifRead()"`, external function) and an empty `id="notif-list"` container that is presumably populated by `app.js` at runtime. Nothing in this file's own `<script>` block touches these elements — the toggle/populate logic all lives outside this file.

### Filter bar (lines 90–120)

This `<section>` holds all of the page's top-level controls: time range, group-by, search/filter, and refresh.

- **Lines 94–99, "Time Range"**: A label ("TIME RANGE") followed by three buttons with `data-range` attributes: `1m`, `5h`, `1d`. The `1m` button (line 96) starts with the `time-btn active` classes plus a secondary-tinted border, so it renders as the selected option on load; the other two (lines 97–98) start in the inactive style (`text-on-surface-variant border-outline-variant`) with hover states. These buttons are wired up later in the script (lines 430–446).
- **Line 100**: A thin vertical divider (`w-px h-5 bg-outline-variant`) used as a visual separator between control groups — this same divider pattern repeats at line 110.
- **Lines 102–109, "Group By"**: A native `<select id="group-by">` with three options: `service`, `level`, and an empty-value `""` labeled "None". This drives the `aggGroupBy` variable used by `getFilteredServices()` later.
- **Lines 112–115, "Search"**: A search icon plus a text `<input id="agg-search">` with placeholder "Filter aggregation results..." — feeds the `aggFilter` variable.
- **Lines 116–118**: The `id="refresh-btn"` button, pushed to the far right via `ml-auto`, with a refresh icon and "REFRESH DATA" label. Wired up at lines 449–458.

### Content: chart row wrapper (lines 122–126)

- **Line 123**: The scrollable content wrapper (`p-margin-safe space-y-gutter flex-1 overflow-auto pb-8`) — this is the element that actually scrolls, since `<main>` itself is a fixed-height flex column.
- **Line 126**: A 3-column CSS grid (`grid grid-cols-3 gap-gutter`) that hosts the volume chart (spanning 2 columns) and the error-distribution card (spanning 1 column) side by side.

### Volume Trend chart markup (lines 127–143)

- **Line 128**: The chart card, `col-span-2`, standard card styling (surface background, border, rounded, padding).
- **Lines 129–141**: Card header: an "h2" title "Log Volume Trend" plus a static badge `+12.4% vs prev` (line 133) — this percentage is a hardcoded string, not computed from the chart's actual data, so it will not update when the chart data changes on refresh or time-range switch. A subtitle describes it as "Aggregated events per minute across all clusters" (line 135). On the right (lines 137–140), a small hardcoded legend with two entries, "API-Gateway" (secondary/green swatch) and "Auth-Service" (blue swatch), matching the two series defined later in the ECharts option.
- **Line 142**: `<div id="volume-chart" class="w-full h-56"></div>` — the empty container ECharts will mount into via `echarts.init` (line 362). Nothing else on this div is pre-rendered; all visual content comes from the script.

### Error Distribution card (lines 145–189)

- **Line 146**: Second grid cell, `col-span-1`.
- **Line 147**: Title "Error Distribution".
- **Lines 148–185**: Four near-identical stat blocks, each following the same pattern — a label/value row followed by a track-and-fill progress bar:
  - **Critical Errors** (149–157): value `429`, fill width `12%`, bar colored `bg-error`.
  - **Warnings** (158–166): value `2,104`, fill width `42%`, bar colored `bg-amber-400`.
  - **Info Logs** (167–175): value `18,590`, fill width `88%`, bar colored `bg-secondary`.
  - **Debug Trace** (176–184): value `54,201`, fill width `100%`, bar colored `bg-blue-400/60`.

  All four values and all four bar widths are hardcoded directly in the HTML `style="width: X%"` attributes and text nodes — there is no JavaScript in this file that computes or updates these numbers or bar widths. They are static mock data baked into the markup, not derived from the counts shown elsewhere (e.g., they don't obviously correspond to the `ALL_SERVICES` table data).
- **Lines 186–188**: A "View Detailed Anomaly Report" button (`id="anomaly-report-btn"`) with an "open in new" icon. Its click handler is registered later at lines 425–427 and simply navigates to `/logs-explorer?level=error` — it doesn't open anything "detailed" in-place, just deep-links to the logs explorer pre-filtered to error level.

### Aggregation Summary table markup (lines 192–222)

- **Lines 193–200**: Card header for "Aggregation Summary" with two static badge spans: "Filtered by: Status > 400" (line 197, a hardcoded label — no actual filter of that kind is applied by the JS below) and `id="range-badge"` showing "Range: 5h" (line 198), which the time-range button handler (line 439) updates dynamically at runtime.
- **Lines 201–214**: The table shell. `<thead>` (203–210) defines five columns: Service Identifier, Total Count, P99 Latency, Error Rate, Status. `<tbody id="agg-tbody">` (line 212) starts empty — all rows are injected by `renderAggTable()` in the script.
- **Lines 215–221**: Pagination footer.
  - Line 216: A "Showing 1 - 5 of 24 active services" sentence where the `1 - 5` span carries class `agg-showing` (updated by script) but the `24` is a hardcoded static number in the markup — note this could drift from the real filtered count if `renderAggTable()`'s computed total differs, since only `.agg-showing` and (if present) `#agg-total` are updated, not this specific "24".
  - Lines 218–219: Previous/Next buttons (`id="agg-prev"`, `id="agg-next"`), with the "prev" button starting `disabled` and dimmed since page 1 has no previous page.

### Aggregation table data and state (lines 226–268)

- **Line 226**: Opens the page's single inline `<script>` block, which contains everything from here through line 459.
- **Lines 228–253, `ALL_SERVICES`**: A hardcoded array of 24 service objects, each with `name`, `count` (pre-formatted string with commas), `latency` (pre-formatted string with unit), `errorRate` (pre-formatted percentage string), `status` (one of `HEALTHY`/`DEGRADED`/`WARNING`), and `color` (a hex swatch used as the row's leading dot). This is the entire dataset backing the aggregation table — it is not fetched from any API; it's a static mock dataset embedded directly in the page source. Any "refresh" or filtering the user performs operates purely on this fixed in-memory array.
- **Lines 255–259**: Module-level mutable state:
  - `PER_PAGE = 5` — rows per page.
  - `aggPage = 1` — current page, 1-indexed.
  - `aggFilter = ''` — current search string.
  - `aggGroupBy = 'service'` — current group/sort mode, defaulting to `'service'` (matches the `<select>`'s first option, though note the `<select>` element itself doesn't have an explicit `selected` attribute set on that option — it happens to be the first, so it renders selected by default, keeping it in sync with this variable's initial value).
  - `aggTotalPages = 1` — cached page count, recomputed each render.
- **Lines 261–265, `STATUS_STYLES`**: A lookup object mapping each status string to a Tailwind class string for its `.status-chip` badge — green/secondary for `HEALTHY`, red/error for `DEGRADED`, amber for `WARNING`.
- **Lines 266–268, `ERROR_RATE_COLORS`**: A parallel lookup mapping each status to a text-color class used to tint the Error Rate cell (so a degraded service's error rate renders in red, etc., independent of the actual numeric value).

### `getFilteredServices()` (lines 270–283)

```
function getFilteredServices() {
  let list = ALL_SERVICES;
  if (aggFilter) { ... }
  if (aggGroupBy === 'level') { ... }
  else if (aggGroupBy === 'service') { ... }
  return list;
}
```

- **Line 271**: Starts `list` as a reference to the full `ALL_SERVICES` array (not a copy, at this point).
- **Lines 272–275**: If `aggFilter` is a non-empty string, lower-cases it into `q` and replaces `list` with a filtered array where either the service's `name` or its `status` (both lower-cased) contains `q` as a substring — this is why typing "healthy" or "degraded" into the search box works as well as typing a partial service name.
- **Lines 276–278**: If `aggGroupBy === 'level'`, builds an `order` map (`HEALTHY: 0, WARNING: 1, DEGRADED: 2`) and sorts a *shallow copy* of `list` (`[...list]`, important because `Array.prototype.sort` mutates in place and `list` might still be the original `ALL_SERVICES` reference if no filter was applied) by that rank, so healthy services float to the top and degraded ones sink to the bottom. Despite the option being labeled "Level" in the `<select>` (line 106) and the variable name `order`, this is actually grouping/sorting by *status* (health level), not by a log severity level like `info`/`warn`/`error` — there is no `level` field on the service objects.
- **Lines 279–281**: Else if `aggGroupBy === 'service'`, sorts a copy alphabetically by `name` via `localeCompare`.
- **Line 282**: Returns the resulting (possibly filtered and/or sorted) list. Note that when `aggGroupBy` is the empty-string "None" option, neither branch runs, so the list keeps `ALL_SERVICES`'s original declared order (filtered only, if a filter is active).

### `renderAggTable()` (lines 285–338)

This is the function that actually paints the `<tbody>` and updates pagination UI; it's re-invoked on every state change (filter typed, group-by changed, page button clicked, initial load).

- **Line 286**: Gets the current filtered/sorted list via `getFilteredServices()`.
- **Lines 287–289**: Computes `totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))` (at least 1 page even if the filtered list is empty), stores it in the module-level `aggTotalPages`, and clamps `aggPage` down if it's now out of range (e.g., the user was on page 5 but a new filter reduced the results to 2 pages).
- **Lines 291–294**: Grabs the `#agg-tbody` element, clears its `innerHTML`, computes the zero-based `start` index for the current page, and slices out just that page's `pageServices`.
- **Lines 297–298**: Looks up an optional `#agg-total` element (not present anywhere in this file's HTML — this element doesn't exist in the markup, so this line is effectively a defensive no-op guarded by `if (totalServices)`) and would set its text to the filtered count if it existed.
- **Lines 300–304**: Looks up `.agg-showing` (the span inside the "Showing X - Y of Z" sentence, line 216) and sets its text to `"{start+1} - {end}"`, or `'0'` if the filtered list is empty. This is the piece of the pagination summary that *is* actually kept live; the "24" total count elsewhere in that sentence (line 216) is never updated by this function, so it will read stale/wrong once a filter reduces the visible services below 24.
- **Lines 306–324**: `pageServices.forEach(svc => { ... })` — for each service on the current page:
  - Line 307–308: Looks up its chip style (`ss`) and error-rate color (`erColor`) from the two style lookup tables.
  - Lines 309–310: Creates a `<tr>` element with classes `table-row transition-colors cursor-default` (the `table-row` class is what triggers the hover background defined in the `<style>` block at line 16).
  - Lines 311–322: Builds the row's `innerHTML` via a template literal: a first cell with a small colored dot (`svc.color` inline `background` style) plus the service name; then plain cells for count and latency; an error-rate cell colored via `erColor` and bolded; and a status cell containing a `<span class="status-chip ...">` badge using `ss.chip`. Note this uses raw string interpolation of `svc.name`, `svc.count`, etc., directly into `innerHTML` — since the data all comes from the hardcoded `ALL_SERVICES` array (not user input), this isn't an XSS risk in practice, but it's worth flagging as a pattern that would be unsafe with real/untrusted API data.
  - Line 323: Appends the built row to `tbody`.
- **Lines 326–337**: Updates the Prev/Next button state: for `#agg-prev`, toggles `opacity-40`/`cursor-not-allowed` classes and the native `disabled` property based on whether `aggPage === 1`; for `#agg-next`, does the same based on whether `aggPage === totalPages`. This keeps the buttons visually and functionally disabled at the boundaries.

### Table event wiring (lines 340–358)

All wrapped in a single `DOMContentLoaded` listener:

- **Lines 341–343**: `#agg-prev` click — if `aggPage > 1`, decrements `aggPage` and calls `renderAggTable()`.
- **Lines 344–346**: `#agg-next` click — if `aggPage < aggTotalPages`, increments `aggPage` and re-renders.
- **Lines 347–351**: `#group-by` `change` — sets `aggGroupBy` from the select's current `this.value`, resets `aggPage` to 1 (so switching grouping always returns to the first page), and re-renders.
- **Lines 352–356**: `#agg-search` `input` — sets `aggFilter` from `this.value` on every keystroke, resets `aggPage` to 1, and re-renders. There's no debounce here, but since filtering runs entirely in-memory over 24 rows, that's not a performance concern.
- **Line 357**: Calls `renderAggTable()` once immediately on load so the table isn't empty before any user interaction.

### ECharts Volume Trend setup (lines 360–422)

- **Lines 361–362**: Grabs the `#volume-chart` container and initializes an ECharts instance on it (`echarts.init(chartDom, null, { renderer: 'canvas' })`), explicitly requesting the canvas renderer (as opposed to SVG).

**`generateData(base, noise)`** (lines 364–367):
```
function generateData(base, noise) {
  const times = ['12:00 PM', ... '04:00 PM'];
  return times.map((t, i) => ({ time: t, val: Math.max(0, base + Math.sin(i * 0.8) * noise + Math.random() * noise * 0.5) }));
}
```
- Line 365: A fixed array of 9 half-hour timestamp labels from 12:00 PM to 4:00 PM — these are static clock-face strings, not derived from `Date` or the actual selected time range, so switching the time-range buttons (1m/5h/1d) does **not** change these x-axis labels at all, only the y-values (see below).
- Line 366: For each time label, computes a synthetic value: `base` plus a sine wave (`Math.sin(i * 0.8) * noise`, giving a smooth oscillation across the 9 points) plus a random jitter term (`Math.random() * noise * 0.5`), clamped to a minimum of 0 via `Math.max(0, ...)`. This is a purely client-side data simulator — **there is no real backend/API call for chart data anywhere in this file.** Every time this function is invoked, it produces new random numbers.
- **Lines 369–370**: Calls it twice to build the two series: `gwData = generateData(65000, 35000)` (API-Gateway, higher baseline/higher noise) and `authData = generateData(30000, 18000)` (Auth-Service, lower baseline/lower noise).

**ECharts `option` object** (lines 372–419):
- Line 373: `backgroundColor: 'transparent'` — lets the surrounding card's background show through instead of ECharts' default white/black canvas fill.
- Line 374: `grid` — sets the plotting area's inset padding (`top: 10, right: 20, bottom: 30, left: 55`), leaving room for axis labels.
- **Lines 375–387, `tooltip`**: `trigger: 'axis'` means hovering anywhere along the x-axis shows both series' values at once. Custom `backgroundColor`/`borderColor`/`textStyle` give it a dark, monospace-themed look consistent with the rest of the UI. The `formatter` (lines 380–386) is a custom function: it builds an HTML string starting with the hovered axis label (`params[0].axisValue`), then loops over every series point in `params` and appends a row with a colored dot (`p.color`), the series name, and its value rounded and comma-formatted via `Math.round(p.value).toLocaleString()`.
- **Lines 388–394, `xAxis`**: `type: 'category'` using `gwData.map(d => d.time)` as the category labels (i.e., the same static time strings from `generateData`, taken from the gateway series specifically — both series share the same time labels since they're generated from the same fixed `times` array). Axis line, label color/font, and hides the vertical split lines.
- **Lines 395–400, `yAxis`**: `type: 'value'` with a label `formatter` that abbreviates large numbers as "Nk" for thousands (e.g., 65000 → "65k") and leaves smaller numbers as-is; dashed, low-opacity horizontal split lines; hides the axis line itself.
- **Lines 401–418, `series`**: Two line series:
  - **API-Gateway** (402–409): `type: 'line', smooth: true` (curved interpolation), data from `gwData`, green line (`#4edea3`), and a linear-gradient `areaStyle` fading from 30%-opacity green at the top to near-transparent at the bottom (a classic "area under the curve" fill). `symbol: 'none'` hides the per-point markers, leaving just the smooth line and fill.
  - **Auth-Service** (410–417): Same structure, blue (`#60a5fa`), matching the legend swatch in the HTML (line 139), with its own (lighter) gradient area fill.
- **Line 421**: `chart.setOption(option)` — renders the chart for the first time with this option object.
- **Line 422**: Registers a `window resize` listener that calls `chart.resize()`, so the chart canvas stays correctly sized if the browser window (and therefore the card) changes dimensions.

### Anomaly report button wiring (lines 424–427)

- **Line 425**: Attaches a `click` listener to `#anomaly-report-btn` (the button from line 186).
- **Line 426**: On click, navigates the whole page via `window.location.href = '/logs-explorer?level=error'` — a simple hard navigation to the Logs Explorer page pre-filtered to the error level, rather than any in-page modal/report.

### Time-range buttons (lines 429–446)

- **Line 430**: `document.querySelectorAll('.time-btn')` selects all three range buttons (1m/5h/1d) and attaches a click handler to each.
- **Lines 432–435**: On click, first loops over *all* time buttons and strips the "active" look from each — removing `active`, `border-secondary/40`, `text-secondary`, `bg-secondary`, `text-on-secondary` and adding back the inactive `text-on-surface-variant`/`border-outline-variant` classes. (Note `bg-secondary`/`text-on-secondary` are removed here even though nothing in the initial markup adds them via the `active` class combination shown at lines 96–98 — the CSS rule at line 15, `.time-btn.active { background: var(--secondary); color: var(--on-secondary); }`, applies the equivalent styling directly rather than via those utility classes, so this cleanup is a defensive/belt-and-suspenders reset.)
- **Lines 436–437**: Adds `active` to the clicked button and strips its inactive-state classes, visually marking it selected.
- **Lines 438–440**: Reads the clicked button's trimmed text content (e.g., `"5h"`) as `rangeLabel` and writes `"Range: 5h"` into `#range-badge` (the badge in the aggregation table header, line 198) — this is the one place the aggregation table's header visibly reacts to the time-range selection, though the underlying `ALL_SERVICES` data and table contents themselves are not filtered by time at all.
- **Lines 441–444**: Comment "Simulate data refresh" — explicitly acknowledging the mock nature of this behavior. Regenerates both series via `generateData(...)` with the same base/noise parameters as the initial load (so switching between 1m/5h/1d doesn't actually change the value ranges or shape, only produces new random noise) and calls `chart.setOption({ series: [...] })` to update just the two series' `data` arrays in place, leaving axis/tooltip config untouched.

### Refresh button (lines 448–458)

- **Line 449**: Click listener on `#refresh-btn`.
- **Lines 450–451**: Finds the button's icon child (`.material-symbols-outlined`, the refresh glyph) and adds Tailwind's `animate-spin` class to spin it, giving visual feedback that a refresh is happening.
- **Lines 452–457**: After an 800ms `setTimeout` (simulating network latency — no actual request is made), removes `animate-spin` and again calls `generateData` for both series and pushes the new values into the chart via `chart.setOption`, identical in effect to the time-range handler's refresh logic. This confirms the "Refresh Data" button doesn't talk to any backend either — it just re-randomizes the same client-side generator and re-renders the chart. The aggregation table and error-distribution bars are untouched by this handler.

### Closing script includes (lines 459–462)

- **Line 459**: Closes the inline `<script>` block.
- **Line 460**: Loads `app.js` — the shared cross-page script presumably responsible for `logout()`, `toggleTheme()`, `toggleNotif()`, `markAllNotifRead()`, and possibly the "Add Log" button behavior, none of which are defined in this file.
- **Lines 461–462**: Closes `</body>` and `</html>`.

### Summary of simulated vs. real data

Every number shown on this page — the volume chart's two series, the four error-distribution bars and their percentages/counts, the "+12.4% vs prev" badge, the 24-row `ALL_SERVICES` aggregation dataset, and the "Filtered by: Status > 400" badge — is either a static literal baked into the HTML/JS or produced by the client-side `generateData()` random generator. There is no `fetch`, `XMLHttpRequest`, `WebSocket`, or similar call anywhere in this file. Filtering, grouping, sorting, and pagination in the aggregation table all operate purely over the in-memory `ALL_SERVICES` array; time-range selection and the refresh button only re-randomize the chart's two series and do not touch the table or the error-distribution bars at all.
