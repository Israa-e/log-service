## public/logs-explorer.html

This file (632 lines) is the main log search/browse screen of the Obsidian Log Engine dashboard. It is a single static HTML document: markup for the sidebar, top bar, notifications panel, filter bar, results table, pagination footer, and a slide-in detail drawer, followed by an inline `<script>` block (lines 261-629) that holds all of the page's state and behavior. It depends on `app.js` (loaded at line 260) for shared utilities (`fetchJSON`, `downloadCSV`, `logout`, `toggleTheme`, `toggleNotif`, `loadNotifications`, `markAllNotifRead`) that are used but not redefined here.

### Document head and global styles (lines 1-35)

- Lines 1-2: standard `<!DOCTYPE html>` and `<html class="dark" lang="en">` — the page defaults to dark mode by having the `dark` class present on load (before `app.js`'s `initTheme()` can correct it from `localStorage`).
- Lines 8-9: pulls in the Tailwind CDN build (with the `forms` and `container-queries` plugins) and then a local `tailwind-config.js` that presumably supplies the custom design tokens used everywhere (`bg-primary`, `text-on-surface-variant`, `font-code-sm`, etc. — none of these are stock Tailwind class names, so they must come from that config).
- Lines 10-14: Google Fonts for Material Symbols (icon font) and two text families, `JetBrains Mono` (monospace, used for code/log data) and `Geist` (the UI face).
- Line 15: shared `styles.css`.
- Lines 16-34: a small inline `<style>` block defining three page-specific classes:
  - `.status-badge` (17-24): the pill styling used for level badges (INFO/WARN/ERROR/DEBUG), monospace, uppercase, small.
  - `.log-row` (26-29): gives every table row a fast background-color transition and a pointer cursor, signaling that rows are clickable.
  - `.log-row.selected` (31-33): overrides the row background using a CSS variable (`--surface-container-high`) with `!important`, so the currently-open-in-drawer row stays visibly highlighted even though `.log-row` rows also get hover/level-tint classes from Tailwind.

### HTML layout

#### Sidebar / SideNavBar (lines 40-91)

A fixed, full-height `<aside>` (240px wide) containing: the "Obsidian Log" logo/title and version string (42-50); a nav list with three links — Logs (active/highlighted, since this is the Logs page), Metrics, Retention (51-64); an "Add Log" button (`#add-log-btn`, 66-69) whose click handling is *not* in this file (it's presumably wired up by a shared script, since no listener for `add-log-btn` appears anywhere in this document); a Docs/Support link block (70-80); and a fake admin identity footer ("Admin Root" / "cluster-admin-01", 81-89) which is static markup, not populated from any API call in this file.

#### Top app bar (lines 97-118)

A header with the page label "Logs" on the left, and on the right: an "Export CSV" button (`#export-csv-btn`, handled at line 607), then a divider followed by three icon buttons — Logout (`onclick="logout()"`, defined in `app.js`), Theme toggle (`onclick="toggleTheme()"`, also in `app.js`), and a Notifications bell (`id="notif-btn"`, `onclick="toggleNotif()"`) with a small red unread-dot badge (`#notif-badge`, hidden by default).

#### Notifications panel (lines 120-126)

`#notif-panel` is a hidden, absolutely positioned dropdown (`right-4 top-16`) with a header ("Notifications" + "Mark all read" button calling `markAllNotifRead()`) and an empty `#notif-list` container that `loadNotifications()` (in `app.js`) fills in at runtime. This file never toggles or populates it directly — `toggleNotif()`/`loadNotifications()` in `app.js` own that behavior; this file only calls `loadNotifications()` once at page load and on an interval (line 627-628).

#### Filter bar (lines 129-197)

A `<section>` with two stacked rows:

1. **Search + time range + run** (131-156):
   - A search `<input id="search-input">` (135-137) with a leading search icon, placeholder text hinting at a query syntax (`status:500`, `message:'timeout'`) — though as shown later (line 334), the value is simply passed through as a raw `q` query param with no client-side parsing.
   - A time-range dropdown (140-150): a button `#time-range-btn` showing an icon, a live label `#time-range-label` (defaults to "All time"), and a chevron; next to it a hidden menu container `#time-range-menu` that gets populated dynamically from the `TIME_RANGES` array (see line 569).
   - A "Run" button `#run-btn` (151-154) with a play icon, for explicitly re-applying filters.

2. **Service select + level checkboxes** (157-196):
   - `#service-filter` (160-170): a `<select>` with a static, hardcoded list of service names (`auth-service`, `payment-gateway`, `inventory-api`, `frontend-web`, `worker-node-04`, `proxy-ingress`, `database-master`) plus an "All Services" empty-value option. These are not fetched from the backend — they're a fixed enum baked into the page.
   - Four level checkboxes (175-194): `chk-info`, `chk-warn`, `chk-error` (all `checked` by default) and `chk-debug` (unchecked by default). Each pairs a checkbox with a colored dot + label (blue/amber/red/gray) matching the level's badge color used later in `LEVEL_STYLES`. The default-unchecked DEBUG box explains why `activeLevels` initializes to `{'info','warn','error'}` only (line 297).

#### Results table (lines 200-218)

A `<table>` with a sticky `<thead>` (four columns: TIMESTAMP (ISO 8601), LEVEL, SERVICE, MESSAGE) and an empty `<tbody id="log-tbody">` that `renderLogs()` fills in entirely at runtime — there is no static/placeholder row markup here beyond what JS injects.

#### Pagination footer (lines 221-246)

A `<footer>` split into two halves:
- Left: a "Showing X - Y of Z events" line built from `#showing-range` and `#total-count` spans, plus a static "LIVE FEED ACTIVE" indicator (a pulsing green dot) that is purely decorative — nothing in this file's JS toggles it based on actual live-tailing state.
- Right: navigation buttons `#btn-first`, `#btn-prev`, a `#page-buttons` container for numbered page chips, `#btn-next`, `#btn-last`. All are empty of inline handlers; behavior is attached in the script block (lines 510-538).

#### Log detail drawer (lines 250-259)

`#detail-drawer` is a fixed-position panel (420px wide) pinned to the right edge, initially off-screen via `translate-x-full` and animated with `transition-transform duration-300 ease-in-out`. It has a header ("Log Detail" + a close `<button id="close-drawer">`) and an empty `#drawer-content` div that `openDrawer()` (line 375) fills with the clicked log's full detail.

### State variables and mock data (lines 262-315)

- **`SAMPLE_LOGS`** (262-288): an array of 25 hardcoded fake log objects (`level`, `service`, `msg`, `attrs`). This constant is declared but never referenced anywhere else in the script — `renderLogs()` always calls the real `/logs` endpoint via `fetchJSON`. In other words, **`SAMPLE_LOGS` is dead code / leftover mock data**: it is not wired into any rendering path in this file. It was likely used during earlier UI prototyping before the fetch-based `renderLogs()` was implemented, and is not used in production of this page.
- **`LEVEL_STYLES`** (290-295): a lookup object keyed by log level (`info`, `warn`, `error`, `debug`), each entry providing:
  - `badge`: Tailwind classes for the status pill (e.g., error uses `bg-error-container text-error border border-error/50`).
  - `row`: a subtle background tint for the whole row (empty for info/debug, faint amber/red tint for warn/error).
  - `leftBorder`: a colored left border accent (`border-l-2 border-l-amber-500` for warn, `border-l-2 border-l-error` for error; none for info/debug). This is consumed in `renderLogs()` (line 357) to visually flag warnings and errors in the table.
- **`activeLevels`** (297): `new Set(['info', 'warn', 'error'])` — mirrors the checkbox defaults (debug unchecked). Mutated by the checkbox change listeners (545-551).
- **`selectedService`** (298): empty string = "All Services", updated by the service `<select>` listener (553-557).
- **`searchQuery`** (299): empty string initially, updated on every keystroke in the search input (559-563).
- **`selectedRow`** (300): tracks the currently-selected `<tr>` DOM element (for toggling the `.selected` CSS class), `null` when the drawer is closed.
- **`TIME_RANGES`** (302-309): an ordered array of six `{label, ms}` entries — Last 15m, 1h, 6h, 24h, 7d, and "All time" (`ms: null`, meaning "no `since` filter"). This drives both the dropdown menu contents and the `since` query param computation.
- **`selectedRange`** (310): `TIME_RANGES[5]` — defaults to "All time".
- **`currentPage`** (312): starts at `1`.
- **`limit`** (313): fixed page size of `25`, `const` — never changed by any UI control (there's no page-size selector on this page).
- **`totalLogs`** (314): server-reported total row count, starts at `0`.
- **`logs`** (315): the current page's array of log objects as last returned by the server; also the source array for CSV export.

### renderLogs() — core fetch-and-render function (lines 317-373)

This `async function` is the single place that talks to the backend and repaints the table; it's called on init and by every filter/pagination control.

1. **Loading state** (318-319): grabs `#log-tbody` and immediately replaces its contents with a 4-column-spanning "Loading logs..." row, so the UI gives instant feedback before the network round-trip resolves.
2. **Query-string construction** (321-339), via `URLSearchParams`:
   - `limit` and `page` are always set (322-323), from the `limit` constant and `currentPage`.
   - `service` is set only if `selectedService` is truthy (325-327) — omitted entirely for "All Services".
   - `level` (329-331): only added if `activeLevels.size > 0 && activeLevels.size < 4`. The upper bound `< 4` means when *all four* levels are checked, the `level` param is dropped entirely (equivalent to "no filter" server-side, saving a redundant param); the lower bound `> 0` guards against building `level=` with an empty joined string when everything is unchecked. When present, it's a comma-joined list, e.g. `level=info,error`.
   - `q` (333-335): set only if `searchQuery` is non-empty; sent as raw text with no client-side transformation.
   - `since` (337-339): set only if `selectedRange.ms` is not `null` (i.e., not "All time"); computed as `new Date(Date.now() - selectedRange.ms).toISOString()` — an absolute ISO-8601 cutoff timestamp computed fresh on every call, not a relative duration string.
3. **The fetch** (341): `const data = await fetchJSON('/logs?' + params.toString());`. `fetchJSON` (defined in `app.js`) does a plain `fetch`, returns `null` on any network error or non-OK response, and otherwise parses the JSON body. So the real endpoint hit is `GET /logs` with the query params assembled above — no other endpoint is used for the table body.
4. **Empty/error handling** (344-349): if `data` is falsy, or `data.logs` is missing/empty, the tbody is replaced with a "No logs found" message, `totalLogs` is reset to `0`, `updatePagination()` is called (to reflect zero results in the footer/pagination controls), and the function returns early — this path also covers `fetchJSON` returning `null` on a network failure, effectively treating "server error" and "genuinely empty result set" the same way in the UI.
5. **Success path** (351-352): `logs = data.logs` (replaces the module-level array used later for the drawer and CSV export) and `totalLogs = data.total || logs.length` — falls back to the current page's length if the server doesn't report a `total` field.
6. **Row rendering loop** (354-370), for each `log` at index `i`:
   - Looks up `LEVEL_STYLES[log.level]`, falling back to the `info` style if the level is unrecognized (355).
   - Creates a `<tr>`, applies base classes plus the level's `row` tint and `leftBorder` accent (357), and stores the loop index on `tr.dataset.index` (358) — note this `data-index` attribute is set but never read anywhere else in the script; the click handler instead closes over `log`, `tr`, and `i` directly via the arrow function at line 368, so `dataset.index` is effectively unused/vestigial.
   - Formats the timestamp (360): `new Date(log.timestamp).toISOString().replace('T', ' ').slice(0, 23)` — converts to UTC ISO format, swaps the `T` separator for a space, and truncates to 23 characters, yielding `YYYY-MM-DD HH:MM:SS.mmm`.
   - Builds the row's inner HTML (362-367): timestamp cell; a status badge cell using `s.badge` and `log.level.toUpperCase()`; a service-name cell (teal/secondary colored); a message cell whose text color is conditionally `text-error font-bold` when `log.level === 'error'`, otherwise the default on-surface color that brightens on row hover (`group-hover:text-primary`), truncated with `truncate max-w-0 w-full` so long messages ellipsize instead of expanding the column.
   - Attaches a click listener (368) calling `openDrawer(log, tr, i)`, then appends the row to the tbody (369).
7. **Final step** (372): calls `updatePagination()` to refresh the footer/page-buttons based on the newly-fetched `totalLogs`/`currentPage`.

### openDrawer() — detail rendering (lines 375-400)

Called with the specific `log` object, its table `<tr>` element, and its index (the index parameter `i` is accepted but not actually used inside the function body).

1. **Row selection bookkeeping** (376-378): deselects the previously selected row (`selectedRow.classList.remove('selected')`) if one exists, then marks the new row as `selectedRow` and adds the `.selected` class to it — this is what drives the persistent highlight defined in the `.log-row.selected` CSS rule.
2. **Style + element lookup** (379-381): resolves `LEVEL_STYLES` for this log's level (with the same `info` fallback), and grabs the `#detail-drawer` and `#drawer-content` elements.
3. **Timestamp formatting** (383): identical formatting logic to `renderLogs()` (`ISO string → space-separated → 23 chars`), duplicated rather than factored into a shared helper.
4. **Content injection** (385-398): builds a detail view with:
   - A header line combining the level badge and the service name (387).
   - The full log message, unrestricted/untruncated this time (388).
   - A "TIMESTAMP" section showing the formatted time (389-392).
   - An "ATTRIBUTES" section (393-396) rendering `JSON.stringify(log.attributes || {}, null, 2)` inside a `<pre>` block — pretty-printed with 2-space indentation, defaulting to an empty object if the log has no `attributes` field. (Note: the mock `SAMPLE_LOGS` array used an `attrs` key, but this code reads `log.attributes` — another sign `SAMPLE_LOGS` was never actually wired to this rendering path, since the key names don't even match.)
5. **Reveal** (399): removes `translate-x-full` from the drawer, sliding it into view via the CSS transition declared on the element.

The drawer is closed elsewhere: the `#close-drawer` click handler (540-543) re-adds `translate-x-full` and clears `selectedRow`/its `.selected` class, but note it does not remove `.selected` from `tr` directly inside `openDrawer` — that only happens on next `openDrawer` call or on explicit close.

### updatePagination() and the page-number/ellipsis algorithm (lines 402-508)

This function rebuilds the footer's "Showing X-Y of Z" text, enables/disables the first/prev/next/last buttons, and regenerates the row of numbered page chips with ellipses.

1. **Page bounds** (403-406): `totalPages = Math.max(1, Math.ceil(totalLogs / limit))` — guarantees at least 1 page even when `totalLogs` is 0. If `currentPage` has drifted past `totalPages` (e.g., a filter change shrank the result set), it's clamped down to `totalPages`.
2. **Range text** (408-419): `startRange = (currentPage - 1) * limit + 1`, `endRange = Math.min(currentPage * limit, totalLogs)`. `#showing-range` gets `"1,234 - 1,258"`-style locale-formatted numbers (or literal `'0'` when `totalLogs` is 0), and `#total-count` gets the locale-formatted `totalLogs`.
3. **Prev/first button state** (426-436): both disabled (opacity-50, `disabled = true`, not-allowed cursor) when `currentPage === 1`, enabled otherwise.
4. **Next/last button state** (438-448): both disabled when `currentPage === totalPages`, enabled otherwise.
5. **Page chip helpers**:
   - `addPageBtn(pageNum, active)` (454-470): creates a `<span>` styled as a clickable chip; if `active`, applies the highlighted "current page" styling (`bg-secondary text-background`), otherwise a hover style. Clicking it sets `currentPage = pageNum` and calls `renderLogs()`, but only if it isn't already the current page (464) — avoids a redundant refetch.
   - `addEllipsis()` (472-477): appends a static, non-interactive `<span>` containing `...`.
6. **The algorithm itself** (479-507), reset each call via `pageButtons.innerHTML = ''` (452):
   - **`totalPages <= 5`** (479-482): show every page number, 1 through `totalPages`, with the current one marked active. No ellipses needed since the whole range fits.
   - **Otherwise (`totalPages > 5`)**, three cases based on where `currentPage` sits:
     - **Near the start** (`currentPage <= 3`, lines 484-490): show pages `1, 2, 3, 4`, then an ellipsis, then the last page. This always shows exactly 4 leading numbers regardless of whether currentPage is 1, 2, or 3 — so e.g. on page 1 of 20, you'd see `[1] 2 3 4 ... 20` with 1 active.
     - **Near the end** (`currentPage >= totalPages - 2`, lines 491-497): show page `1`, an ellipsis, then the last four pages (`totalPages-3` through `totalPages`), with whichever matches `currentPage` marked active. Symmetric to the start case.
     - **Middle** (else branch, lines 498-506): show page `1`, an ellipsis, then `currentPage - 1`, `currentPage` (active), `currentPage + 1`, then another ellipsis, then the last page — a classic "sliding window of 3 around the current page, anchored by first/last" pattern.
   - Note the three branches are not mutually exclusive by construction for edge values, but the `if/else if/else` ordering ensures each `currentPage` value only ever matches exactly one branch: the boundary between "near start" and "middle" is `currentPage <= 3` vs. `4`, and between "middle" and "near end" is `currentPage < totalPages - 2` vs. `>= totalPages - 2`, which only works consistently for `totalPages > 5` (guaranteed by the outer `if`).

### Event listeners (lines 510-628)

- **`#btn-first`** (510-515): jumps to page 1 (only if not already there), then `renderLogs()`.
- **`#btn-prev`** (517-522): decrements `currentPage` if `> 1`, then `renderLogs()`.
- **`#btn-next`** (524-530): recomputes `totalPages` locally and increments `currentPage` if not already last, then `renderLogs()`.
- **`#btn-last`** (532-538): recomputes `totalPages` and jumps straight to it if not already there, then `renderLogs()`.
- **`#close-drawer`** (540-543): slides the drawer out (`translate-x-full`) and clears the row selection state.
- **Level checkboxes** (545-551): iterates the four level ids (`chk-info`, `chk-warn`, `chk-error`, `chk-debug`); on `change`, adds/removes the level from `activeLevels` based on `this.checked`, resets `currentPage` to 1 (any filter change restarts pagination), and calls `renderLogs()`.
- **`#service-filter`** (553-557): on `change`, updates `selectedService`, resets to page 1, re-renders.
- **`#search-input`** (559-563): on every `input` event (i.e., live, per-keystroke — not debounced), updates `searchQuery`, resets to page 1, and immediately re-fetches. There is no debounce/throttle here, so rapid typing triggers a fetch per keystroke.
- **Time-range dropdown** (565-600):
  - Menu population (569-574): `timeRangeMenu.innerHTML` is built by mapping `TIME_RANGES` to buttons tagged with `data-range-index`, highlighting whichever entry currently equals `selectedRange` (object identity comparison, `r === selectedRange`) in secondary/bold text.
  - Menu item clicks (576-589): looks up the clicked index, sets `selectedRange` to that `TIME_RANGES` entry, updates the visible label, then re-applies the active/inactive classes across all menu buttons by comparing each to the clicked `btn` element (rather than rebuilding the whole menu HTML again), hides the menu, resets to page 1, and re-renders.
  - Button toggle (591-594): clicking `#time-range-btn` calls `e.stopPropagation()` (so the subsequent document-level click listener doesn't immediately re-close it) and toggles the menu's `hidden` class.
  - Outside-click close (596-600): a document-wide click listener closes the menu if it's open and the click target is neither inside the menu nor the toggle button itself.
- **`#run-btn`** (602-605): resets to page 1 and re-renders — effectively a manual "apply filters now" action, redundant with the auto-refresh behavior of the other controls but useful for e.g. re-running the same query to get fresh results.

### CSV export (lines 607-620)

`#export-csv-btn`'s click handler:
1. Guards against exporting when `logs` (the currently loaded page, not all matching logs) is empty (608-611), showing a toast via the optional-chained `window.showToast?.('No logs to export', 'info')` (so it silently no-ops if the shared toast system from `app.js` isn't present).
2. Maps the in-memory `logs` array to plain rows (612-617): `[ISO timestamp, level, service, message]` for each entry — note this re-derives the ISO timestamp from `log.timestamp` again rather than reusing the already-formatted display string.
3. Calls `downloadCSV(filename, headers, rows)` (618), from `app.js`, with a timestamped filename `logs-export-<Date.now()>.csv` and headers `['Timestamp', 'Level', 'Service', 'Message']`. `downloadCSV` (in `app.js`) CSV-escapes each cell, builds a `Blob`, and triggers a browser download via a temporary anchor element.
4. Shows a success toast reporting how many logs were exported (619).

Because this only exports `logs` (the current page's 25-or-fewer rows), "Export CSV" exports the currently visible page, not the entire filtered result set.

### Periodic refresh and page load (lines 622-629)

- Line 623: `window.refreshLogsExplorer = renderLogs;` — exposes `renderLogs` on the global `window` object under a distinct name, specifically so that some other part of the app (per the comment, "the shared Add Log modal") can trigger a table refresh after a log is successfully submitted elsewhere, without that other code needing to know this page's internal function names.
- Line 626: `renderLogs()` — the initial data load when the page first runs.
- Line 627: `loadNotifications()` — initial population of the notifications panel/badge (function defined in `app.js`).
- Line 628: `setInterval(loadNotifications, 30000)` — polls for new notifications every 30 seconds. Note this only refreshes notifications, not the log table itself — there is no analogous auto-refresh interval for `renderLogs()`, despite the "LIVE FEED ACTIVE" indicator in the footer suggesting continuous updates.
