## public/app.js

This file is loaded on every dashboard page. It has no imports/exports — it's a plain script that defines globals (via top-level `function` declarations, which attach to `window`) and then runs one big IIFE at the bottom that injects CSS and DOM for shared widgets (toasts, the Add Log modal, the Docs drawer, the Support chat drawer) and wires up their behavior.

### Theme System (lines 1–20)

```js
1  /* === Theme System === */
2  function initTheme() {
3    const saved = localStorage.getItem('obsidian-theme');
4    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
5    const theme = saved || (prefersDark ? 'dark' : 'light');
6    document.documentElement.classList.toggle('dark', theme === 'dark');
7    document.documentElement.classList.toggle('light', theme === 'light');
8    const icon = document.getElementById('theme-icon');
9    if (icon) icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
10 }
```

- Line 3: reads a previously saved theme choice from `localStorage` under the key `obsidian-theme`. This is how the choice persists across page loads/navigations.
- Line 4: falls back to the OS/browser's preferred color scheme via `matchMedia` when there's no saved preference.
- Line 5: `theme` is `saved` if present, otherwise derived from the media query.
- Lines 6–7: `classList.toggle(className, force)` with an explicit boolean sets (not toggles) the class — so `dark` is added only when `theme === 'dark'`, and `light` only when `theme === 'light'`. This means the `<html>` element always carries exactly one of the two classes, which is presumably what the Tailwind config/CSS variables key off of.
- Lines 8–9: updates the theme-toggle button's icon (a Material Symbols icon element with id `theme-icon`) to show the *other* mode's icon — i.e. when currently dark, the icon shown is `light_mode` (clicking it would switch to light). The `if (icon)` guard means this function is safe to call on pages that don't have a theme toggle button in the DOM.

```js
12 function toggleTheme() {
13   const html = document.documentElement;
14   html.classList.toggle('dark');
15   html.classList.toggle('light');
16   const isDark = html.classList.contains('dark');
17   localStorage.setItem('obsidian-theme', isDark ? 'dark' : 'light');
18   const icon = document.getElementById('theme-icon');
19   if (icon) icon.textContent = isDark ? 'light_mode' : 'dark_mode';
20 }
```

- Lines 14–15: here `classList.toggle` is called *without* a second argument, so it flips each class's current presence. Because `initTheme` guarantees exactly one of `dark`/`light` is set beforehand, flipping both swaps which one is active (e.g. `dark` on + `light` off becomes `dark` off + `light` on).
- Line 16: reads back the new state from the DOM rather than computing it locally, so it's always consistent with whatever `classList.toggle` actually did.
- Line 17: persists the new choice to `localStorage` so it survives a reload.
- Lines 18–19: same icon update as `initTheme`, again guarded for pages without the icon element. `toggleTheme` is presumably wired to a click handler in each page's own inline script or HTML (`onclick="toggleTheme()"`), since no such binding appears in this file.

### API Utilities — fetchJSON (lines 22–29)

```js
22 /* === API Utilities === */
23 async function fetchJSON(url) {
24   try {
25     const r = await fetch(url);
26     if (!r.ok) return null;
27     return await r.json();
28   } catch { return null; }
29 }
```

A defensive wrapper around `fetch` used throughout the dashboard (and later in this same file, e.g. `loadNotifications`):
- Line 25: issues the GET request.
- Line 26: if the HTTP status is not in the 2xx range, `r.ok` is `false` and the function returns `null` instead of throwing — callers don't need to check `response.status` themselves.
- Line 27: parses the body as JSON and returns it.
- Line 28: a bare `catch { }` (no bound error variable) swallows any network error or JSON-parse error and again returns `null`. This means every caller of `fetchJSON` must handle a `null` result (missing data, offline, bad JSON, non-2xx status) uniformly, without knowing which case occurred.

### CSV Export — downloadCSV (lines 31–47)

```js
31 /* === CSV Export === */
32 function downloadCSV(filename, headers, rows) {
33   const escapeCell = (val) => {
34     const str = String(val ?? '');
35     return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
36   };
37   const lines = [headers, ...rows].map(row => row.map(escapeCell).join(','));
38   const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
39   const url = URL.createObjectURL(blob);
40   const a = document.createElement('a');
41   a.href = url;
42   a.download = filename;
43   document.body.appendChild(a);
44   a.click();
45   a.remove();
46   URL.revokeObjectURL(url);
47 }
```

- Lines 33–36: `escapeCell` implements RFC-4180-style CSV quoting. `val ?? ''` converts `null`/`undefined` cells to an empty string before stringifying (so `String(null)` never becomes the literal text `"null"`). The regex `/[",\n]/` checks whether the cell contains a double quote, a comma, or a newline; if so, the whole cell is wrapped in double quotes and any internal `"` is doubled (`""`) per CSV escaping rules.
- Line 37: builds the full set of CSV lines by prepending the `headers` array to the `rows` array (spread into one array), then mapping each row array through `escapeCell` and joining with commas.
- Line 38: joins all lines with `\n` and wraps the text in a `Blob` typed as `text/csv;charset=utf-8;`, which is what makes a downloaded file open correctly as CSV/Excel data.
- Line 39: `URL.createObjectURL(blob)` creates a temporary object URL that a link can point to.
- Lines 40–44: builds an invisible-in-practice `<a>` element, sets its `href` to the blob URL and `download` to the desired filename, appends it to the DOM (some browsers require the anchor to be attached before `.click()` will trigger a download), and programmatically clicks it to start the save-file dialog/download.
- Line 45: removes the anchor from the DOM immediately after triggering the click — it was only needed transiently.
- Line 46: `URL.revokeObjectURL(url)` frees the memory backing the blob URL now that the download has been initiated, avoiding a memory leak if this is called repeatedly (e.g. exporting several times per session).

### Time Helpers (lines 49–60)

```js
49 /* === Time Helpers === */
50 function ago(minutes) {
51   return new Date(Date.now() - minutes * 60 * 1000).toISOString();
52 }
53
54 function formatTime(iso) {
55   return new Date(iso).toLocaleString();
56 }
57
58 function formatTimeShort(iso) {
59   return new Date(iso).toLocaleTimeString();
60 }
```

- `ago(minutes)` (line 50–52): computes an ISO-8601 timestamp `minutes` minutes before "now" — useful for building relative time-range query parameters (e.g. "logs from the last 15 minutes") to send to the API.
- `formatTime(iso)` (line 54–56): converts an ISO timestamp string into the user's locale date+time string (`toLocaleString`) for full display, e.g. in a details view.
- `formatTimeShort(iso)` (line 58–60): converts an ISO timestamp into just the locale time-of-day (`toLocaleTimeString`), used where space is tight, such as in the compact log row renderer below.

### Level Helpers (lines 62–78)

```js
63 const LEVEL_COLORS = {
64   error: { bg: 'bg-error/15', text: 'text-error', border: 'border-error/30' },
65   warn: { bg: 'bg-amber-400/15', text: 'text-amber-400', border: 'border-amber-400/30' },
66   info: { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/20' },
67   debug: { bg: 'bg-outline/10', text: 'text-outline', border: 'border-outline/20' },
68   success: { bg: 'bg-secondary/15', text: 'text-secondary', border: 'border-secondary/30' },
69 };
```

A lookup table mapping each log level (`error`, `warn`, `info`, `debug`, `success`) to a set of Tailwind utility classes (background, text color, border color, each with an opacity modifier like `/15`) used to color-code that level consistently across the UI.

```js
71 function levelBadge(lvl) {
72   const c = LEVEL_COLORS[lvl] || LEVEL_COLORS.info;
73   return `<span class="px-2 py-0.5 ${c.bg} ${c.text} ${c.border} border rounded-full text-[10px] font-bold uppercase">${lvl}</span>`;
74 }
```

- Line 72: looks up the color set for `lvl`, defaulting to the `info` styling if `lvl` isn't a recognized key (defensive fallback for unexpected level strings from the API).
- Line 73: returns an HTML string for a small pill/badge — padded, rounded-full, tiny bold uppercase text — using the resolved Tailwind classes. This is a raw HTML-string builder (not a DOM node), meant to be interpolated into a larger template literal via `innerHTML`.

```js
76 function levelRowClass(lvl) {
77   return `log-row-${lvl}`;
78 }
```

Produces a CSS class name like `log-row-error` for a given level. This class isn't defined anywhere in this file's injected CSS, so it must be styled by a page-level stylesheet (e.g. for a colored left border on the row depending on severity) — this file only supplies the class name via string interpolation.

### Log Stream Renderer (lines 80–87)

```js
81 function renderLogRow(log) {
82   return `<div class="flex items-start gap-3 py-1 px-2 hover:bg-surface-container-highest/20 border-l-4 ${levelRowClass(log.level)}">
83     <span class="text-on-surface-variant/60 w-28 shrink-0 font-mono text-xs">${formatTimeShort(log.timestamp)}</span>
84     ${levelBadge(log.level)}
85     <span class="text-on-surface flex-1 truncate text-xs">${log.service}: ${log.message}</span>
86   </div>`;
87 }
```

Builds one HTML row for a single log entry, intended to be joined with other rows and inserted into a container's `innerHTML` (the pattern used later in `loadNotifications`):
- Line 82: outer flex row with a 4px left border colored via `levelRowClass(log.level)`, plus a subtle hover highlight.
- Line 83: a fixed-width (`w-28`), non-shrinking, monospace timestamp column showing just the time-of-day via `formatTimeShort`.
- Line 84: embeds the level badge produced by `levelBadge`.
- Line 85: the remaining flexible column shows `service: message`, truncated with an ellipsis (`truncate`) if it overflows. Note `log.service` and `log.message` are interpolated directly without HTML-escaping — if the log data contains `<`/`>`/`&`, this would inject raw HTML/markup into the page (a potential stored-XSS vector if log content is attacker-controlled), a detail worth flagging since no escaping helper is applied here, unlike `escapeCell` in the CSV exporter.

### Logout (lines 89–97)

```js
90 async function logout() {
91   try {
92     await fetch('/auth/logout', { method: 'POST' });
93   } catch (e) {
94     // continue even if request fails
95   }
96   window.location.href = '/login.html';
97 }
```

- Line 92: POSTs to `/auth/logout` to invalidate the session/cookie server-side.
- Lines 93–95: if the request throws (network error), the error is caught and ignored — the comment makes the intent explicit: logout should proceed client-side regardless of whether the server call succeeded.
- Line 96: unconditionally redirects to the login page after the `try/catch`, whether or not the server request succeeded, so the user is never stuck on an authenticated-looking page.

### Drawer (lines 99–108)

```js
100 function openDrawer(id) {
101   const el = document.getElementById(id);
102   if (el) el.classList.remove('translate-x-full');
103 }
104
105 function closeDrawer(id) {
106   const el = document.getElementById(id);
107   if (el) el.classList.add('translate-x-full');
108 }
```

Generic, id-based drawer helpers driven by Tailwind's `translate-x-full` utility (which slides an element fully off-screen to the right via `transform: translateX(100%)`). `openDrawer` removes that class so the panel slides into view; `closeDrawer` re-adds it to slide the panel back out. Both guard against a missing element. These are distinct from — and simpler than — the `custom-drawer`/`active`-class drawer mechanism built later in the IIFE for the Docs and Support panels; this pair looks like a general-purpose utility any page-specific drawer element (using the `translate-x-full` convention) can use directly by id.

### Notifications (lines 110–167)

```js
111 async function loadNotifications() {
112   const data = await fetchJSON('/notifications');
113   const list = data?.notifications || [];
114   const badge = document.getElementById('notif-badge');
115   const container = document.getElementById('notif-list');
116   if (!container) return;
117   const unread = list.filter(n => !n.is_read);
118   if (badge) {
119     badge.classList.toggle('hidden', unread.length === 0);
120   }
121   if (!list.length) {
122     container.innerHTML = '<div class="px-4 py-8 text-center text-on-surface-variant text-sm">No notifications</div>';
123     return;
124   }
```

- Line 112: fetches `/notifications` using the earlier `fetchJSON` helper (so a failed/`null` response is handled gracefully).
- Line 113: optional-chains into `data?.notifications`, defaulting to an empty array if `data` is `null` or lacks that field.
- Lines 114–115: grabs the badge element (the small unread-count dot/indicator) and the list container by id.
- Line 116: if there's no container in the current page's DOM, bails out early — this function is safe to call from pages without a notification list.
- Line 117: computes the unread subset by filtering out any notification whose `is_read` is truthy.
- Lines 118–120: shows/hides the badge — `classList.toggle('hidden', unread.length === 0)` hides the badge when there are zero unread notifications, and shows it otherwise.
- Lines 121–124: if the full list is empty, replaces the container's content with a centered "No notifications" placeholder message and returns early.

```js
125   container.innerHTML = list.map(n => {
126     const icons = { alert: 'notification_important', retention: 'storage', system: 'info' };
127     const icon = icons[n.type] || 'circle';
128     const time = new Date(n.created_at).toLocaleString();
129     return `<div class="px-4 py-3 border-b border-outline-variant/10 hover:bg-surface-container-highest/30 ${n.is_read ? 'opacity-60' : ''}">
130       <div class="flex items-start gap-3">
131         <span class="material-symbols-outlined text-sm mt-0.5 ${n.type === 'alert' ? 'text-error' : n.type === 'retention' ? 'text-tertiary' : 'text-primary'}">${icon}</span>
132         <div class="flex-1 min-w-0">
133           <div class="flex justify-between items-start gap-2">
134             <p class="text-sm font-medium truncate">${n.title}</p>
135             ${n.is_read ? '' : '<span class="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5"></span>'}
136           </div>
137           <p class="text-xs text-on-surface-variant mt-0.5 truncate">${n.message}</p>
138           <p class="text-[10px] text-on-surface-variant/60 mt-1">${time}</p>
139         </div>
140       </div>
141     </div>`;
142   }).join('');
143 }
```

For the non-empty case, each notification `n` is mapped to an HTML card and all cards are joined into one string assigned to `container.innerHTML`:
- Line 126: a small icon lookup table keyed by notification `type` (`alert`, `retention`, `system`).
- Line 127: falls back to a generic `circle` icon glyph for any unrecognized type.
- Line 128: formats `created_at` using the full locale date-time string.
- Line 129: the outer row fades to 60% opacity (`opacity-60`) when `is_read` is true, giving read notifications a visually de-emphasized look.
- Line 131: the icon's color is chosen with a nested ternary — error-red for `alert`, tertiary color for `retention`, primary color for everything else (including `system`).
- Lines 133–136: title row; if unread, an extra small filled dot (`w-2 h-2 rounded-full bg-primary`) is appended next to the title as an unread indicator — if read, that span is simply an empty string.
- Lines 137–138: the message body (truncated) and the formatted timestamp, in progressively smaller/dimmer text.
- Note: like `renderLogRow`, `n.title` and `n.message` are interpolated without escaping.

```js
145 function toggleNotif() {
146   const panel = document.getElementById('notif-panel');
147   if (!panel) return;
148   panel.classList.toggle('hidden');
149   if (!panel.classList.contains('hidden')) loadNotifications();
150 }
```

- Line 146–147: looks up the notification dropdown/panel; no-ops if absent.
- Line 148: flips its visibility via the `hidden` class.
- Line 149: only when the panel ends up *visible* (i.e. `hidden` was just removed) does it trigger a fresh `loadNotifications()` fetch — so opening the panel always refreshes its contents, but closing it doesn't re-fetch.

```js
152 document.addEventListener('click', function (e) {
153   const panel = document.getElementById('notif-panel');
154   const btn = document.getElementById('notif-btn');
155   if (panel && btn && !panel.contains(e.target) && !btn.contains(e.target)) {
156     panel.classList.add('hidden');
157   }
158 });
```

A global click-outside handler registered once at script-load time (not inside the IIFE). On every click anywhere in the document, if both the panel and the trigger button exist, and the click target is inside neither of them, the panel is force-hidden. This is the standard "click outside to dismiss a popover" pattern, and it runs regardless of which page is loaded (harmlessly no-oping when the ids aren't present).

```js
162 async function markAllNotifRead() {
163   await fetch('/notifications/read-all', { method: 'POST' });
164   loadNotifications();
165   const badge = document.getElementById('notif-badge');
166   if (badge) badge.classList.add('hidden');
167 }
```

- Line 163: POSTs to `/notifications/read-all` to mark every notification as read server-side (a raw `fetch`, not through `fetchJSON`, since no JSON response body is consumed here).
- Line 164: re-fetches and re-renders the notification list so the UI reflects the now-all-read state (each row loses its unread dot/opacity styling).
- Lines 165–166: proactively hides the unread badge immediately, rather than waiting on `loadNotifications` to recompute `unread.length` — an optimistic UI update that happens to be consistent with what the reload will also conclude.

### The IIFE — Dynamic Shared UI Components (lines 169–930)

```js
169 /* === Dynamic Shared UI Components (Docs, Support, Toast Alerts) === */
170 (function () {
171   // Initialize theme on load
172   if (typeof initTheme === 'function') initTheme();
```

The rest of the file is one immediately-invoked function expression that runs as soon as the script is parsed (there is no `DOMContentLoaded` wrapper around the whole thing — only `bindSidebar` at the very end waits for the DOM). Line 172 calls `initTheme()` defensively, checking it's actually a function first — redundant in this file since `initTheme` is defined above at module scope, but defensive if this file were ever split/reordered.

#### Injected shared CSS (lines 174–469)

```js
175   const css = `
176     /* Toast System */
177     .toast-container {
178       position: fixed;
179       bottom: 24px;
180       right: 24px;
181       display: flex;
182       flex-direction: column;
183       gap: 10px;
184       z-index: 9999;
185       pointer-events: none;
186     }
```

A large template literal (lines 175–465) holds hand-written CSS for every dynamically injected widget in this file. It's grouped into five blocks, each worth summarizing rather than walking property-by-property:

- **Toast system** (lines 176–213): `.toast-container` is a fixed bottom-right flex column (`gap: 10px`) stacking toast notifications above everything (`z-index: 9999`), with `pointer-events: none` on the container so empty space doesn't block clicks — restored to `auto` on each individual `.toast`. `.toast` itself is a translucent, blurred (`backdrop-filter: blur(10px)`) rounded pill with a slide-up + fade-in transition; the `.toast.show` class flips `transform`/`opacity` to their "visible" end state — the base `.toast` starts offset by `translateY(20px)` and `opacity: 0`, so adding `.show` animates it into place via the `transition: all 0.3s cubic-bezier(...)`. Three modifier classes (`.toast-success`, `.toast-error`, `.toast-info`, lines 211–213) each add a distinct 4px colored left border to indicate severity.
- **Global drawer elements** (lines 216–261): `.drawer-overlay` is a fixed, full-screen, blurred dark scrim that starts invisible and non-interactive (`opacity: 0; pointer-events: none`) until `.active` is added. `.custom-drawer` is a fixed 500px-wide right-side panel, pushed fully off-screen via `transform: translateX(100%)` and slid into view when `.active` is added (`transform: translateX(0)`); note this is a *different* mechanism from the earlier `translate-x-full` Tailwind-class based `openDrawer`/`closeDrawer` helpers — this one uses hand-rolled CSS classes and an explicit `.active` toggle instead. `.drawer-header` and `.drawer-body` style the fixed top bar and the scrollable content area, using hard-coded hex colors (with comments like `/* surface-container */` noting which design-system token each color approximates, since these dynamically injected elements can't easily reference Tailwind's theme classes/CSS variables directly).
- **Support chat specifics** (lines 264–319): `.chat-container`/`.chat-messages` lay out a vertical, scrollable message list. `.chat-bubble` is a shared bubble style (rounded, max 80% width); `.bubble-bot` aligns left with a "clipped" corner (`border-bottom-left-radius: 2px`) and dark background, while `.bubble-user` aligns right (`align-self: flex-end`) with a white background and its own clipped corner on the opposite side — the classic messaging-app visual pattern. `.chat-input-wrapper`/`.chat-input` style the input row at the bottom, with a `:focus` state (line 317–319) that highlights the border in the app's accent green (`#4edea3`).
- **Docs search and content** (lines 322–379): `.docs-search` styles the search box (with left padding of `40px` to leave room for the search icon positioned absolutely over it — see line 649 later). `.doc-section` is each collapsible card; `.doc-section-header` is the clickable row (`cursor: pointer`, `user-select: none` so double-clicking doesn't select text) with a `:hover` background change; `.doc-section-content` is the expandable body, hidden via the separate `.doc-section-content.hidden { display: none; }` rule (lines 366–368) — note this is a plain custom `.hidden` rule scoped to this element, functionally overlapping with Tailwind's own `.hidden` utility class used elsewhere in the file. `.doc-code-block` styles inline code samples with a monospace font and green text reminiscent of a terminal.
- **Add Log modal** (lines 382–464): mirrors the drawer overlay pattern — `.modal-overlay` is a centered, blurred, fixed backdrop that fades in via `.active`; `.modal-box` additionally animates a slight vertical slide (`translateY(10px)` → `0`) and fade combined with the overlay's own `.active` state (line 410: `.modal-overlay.active .modal-box`). `.modal-header`/`.modal-body`/`.modal-footer` lay out the modal's three sections; `.modal-label` styles field labels (small, uppercase, letter-spaced); `.modal-input` styles text inputs/selects/textarea with a monospace font and the same green focus-border treatment as the chat input; `textarea.modal-input` (line 450) additionally makes the textarea vertically resizable with a minimum height; `.modal-error` styles validation error text in a red/pink tone.

```js
467   const styleEl = document.createElement('style');
468   styleEl.textContent = css;
469   document.head.appendChild(styleEl);
```

The entire CSS string is injected into the page by creating a `<style>` element, setting its text content to the `css` string, and appending it to `<head>` — a runtime alternative to shipping a separate stylesheet, keeping all shared-widget styling colocated with the JS that uses it.

#### Toast container and `showToast` (lines 471–511)

```js
472   let toastContainer = document.querySelector('.toast-container');
473   if (!toastContainer) {
474     toastContainer = document.createElement('div');
475     toastContainer.className = 'toast-container';
476     document.body.appendChild(toastContainer);
477   }
```

Looks for an existing `.toast-container` in the DOM first, and only creates + appends one if none exists — a guard against double-injection if this IIFE somehow ran more than once (or if a page already defines its own container in static HTML).

```js
480   window.showToast = function (message, type = 'info') {
481     const toast = document.createElement('div');
482     toast.className = `toast toast-${type}`;
483
484     const icons = {
485       success: 'check_circle',
486       error: 'error',
487       info: 'info'
488     };
489     const icon = icons[type] || 'info';
490     const colors = {
491       success: 'text-secondary',
492       error: 'text-error',
493       info: 'text-blue-400'
494     };
495
496     toast.innerHTML = `
497       <span class="material-symbols-outlined ${colors[type] || ''}">${icon}</span>
498       <span style="flex-1">${message}</span>
499     `;
500
501     toastContainer.appendChild(toast);
502
503     // Trigger animation
504     setTimeout(() => toast.classList.add('show'), 50);
505
506     // Dismiss automatically
507     setTimeout(() => {
508       toast.classList.remove('show');
509       setTimeout(() => toast.remove(), 300);
510     }, 4000);
511   };
```

`showToast` is assigned onto `window` (rather than declared as a top-level `function`), which is how other pages/scripts invoke it as `window.showToast(...)` or `showToast(...)` (it's used this way later at line 612 as `window.showToast?.(...)`, with optional chaining in case this IIFE hasn't run yet for some reason).
- Line 481–482: creates the toast element with both the base `.toast` class and a type-specific modifier class (`toast-success`/`toast-error`/`toast-info`), defaulting `type` to `'info'` via the default parameter.
- Lines 484–494: two lookup tables select the Material Symbols icon glyph and the Tailwind text-color class for the given `type`, both falling back sensibly (`icons[type] || 'info'`; `colors[type] || ''`) if an unrecognized type is passed.
- Lines 496–499: builds the toast's inner markup — an icon span and a flexible message span (`message` interpolated without escaping, same caveat as elsewhere in this file).
- Line 501: appends the fully-built toast into the shared container.
- Line 504: after a 50ms delay, adds the `.show` class, which is what actually triggers the CSS transition to slide/fade the toast into view — the delay lets the browser register the initial (offscreen/transparent) state before the class change so the transition actually animates rather than the toast appearing already in its end state.
- Lines 507–510: after 4 seconds, removes `.show` (triggering the reverse transition), then after a further 300ms (matching the CSS transition duration) actually removes the element from the DOM — ensuring the fade-out animation completes visually before the node disappears.

#### Add Log modal — markup, open/close, submit (lines 513–626)

```js
514   const addLogOverlay = document.createElement('div');
515   addLogOverlay.className = 'modal-overlay';
516   addLogOverlay.id = 'add-log-overlay';
517   addLogOverlay.innerHTML = `...`;
558   document.body.appendChild(addLogOverlay);
```

Unconditionally (no existence check this time, unlike the toast container) creates the modal overlay element, sets its class/id, fills it with the full modal markup (header with a title and close button; body with a Level `<select>` defaulting to `info`, a Service text input, a Message text input, an Attributes textarea for optional JSON, and a hidden error `<p>`; footer with Cancel/Send Log buttons), and appends it directly to `<body>`.

```js
560   function openAddLogModal() {
561     document.getElementById('add-log-error').classList.add('hidden');
562     addLogOverlay.classList.add('active');
563     document.getElementById('add-log-service').focus();
564   }
565
566   function closeAddLogModal() {
567     addLogOverlay.classList.remove('active');
568   }
```

`openAddLogModal` clears any previously shown error message, activates the overlay (triggering the fade/slide-in CSS), and focuses the Service field so the user can start typing immediately. `closeAddLogModal` simply deactivates the overlay (triggering the reverse CSS transition); it deliberately does not clear the fields here (that happens only on a successful submit, at lines 614–616).

```js
570   document.getElementById('add-log-close').addEventListener('click', closeAddLogModal);
571   document.getElementById('add-log-cancel').addEventListener('click', closeAddLogModal);
572   addLogOverlay.addEventListener('click', (e) => {
573     if (e.target === addLogOverlay) closeAddLogModal();
574   });
```

Three ways to dismiss the modal: the header's close (X) button, the footer's Cancel button, and clicking the dimmed backdrop itself. The backdrop-click handler checks `e.target === addLogOverlay` specifically (not just "anywhere inside the overlay") so that clicks on the modal box itself (which is a child of the overlay, and clicks on it would bubble up to the overlay) don't also close the modal — only a click that actually lands on the overlay background triggers the close.

```js
576   document.getElementById('add-log-submit').addEventListener('click', async () => {
577     const level = document.getElementById('add-log-level').value;
578     const service = document.getElementById('add-log-service').value.trim();
579     const message = document.getElementById('add-log-message').value.trim();
580     const attrsRaw = document.getElementById('add-log-attrs').value.trim();
581     const errorEl = document.getElementById('add-log-error');
582     errorEl.classList.add('hidden');
583
584     if (!service || !message) {
585       errorEl.textContent = 'Service and message are required.';
586       errorEl.classList.remove('hidden');
587       return;
588     }
```

The Send Log button's click handler is an async function performing full client-side validation before any network call:
- Lines 577–580: reads and trims all four field values.
- Line 582: hides any previously shown error first (so the UI doesn't show a stale message while re-validating).
- Lines 584–588: requires both `service` and `message` to be non-empty after trimming; if either is missing, shows an inline error and returns without submitting.

```js
590     let attributes;
591     if (attrsRaw) {
592       try {
593         attributes = JSON.parse(attrsRaw);
594       } catch {
595         errorEl.textContent = 'Attributes must be valid JSON.';
596         errorEl.classList.remove('hidden');
597         return;
598       }
599     }
```

If the optional Attributes textarea has content, it's parsed as JSON; a parse failure shows a specific error message and aborts the submit. If the field is empty, `attributes` stays `undefined` and the JSON-parsing step is skipped entirely.

```js
601     const entry = { timestamp: new Date().toISOString(), level, service, message };
602     if (attributes) entry.attributes = attributes;
603
604     try {
605       const res = await fetch('/logs', {
606         method: 'POST',
607         headers: { 'Content-Type': 'application/json' },
608         body: JSON.stringify({ logs: [entry] }),
609       });
610       const data = await res.json();
611       if (data.accepted > 0) {
612         window.showToast?.('Log added', 'success');
613         closeAddLogModal();
614         document.getElementById('add-log-service').value = '';
615         document.getElementById('add-log-message').value = '';
616         document.getElementById('add-log-attrs').value = '';
617         if (typeof window.refreshLogsExplorer === 'function') window.refreshLogsExplorer();
618       } else {
619         errorEl.textContent = data.rejected?.[0]?.reason || 'Log was rejected.';
620         errorEl.classList.remove('hidden');
621       }
622     } catch {
623       errorEl.textContent = 'Failed to reach the server.';
624       errorEl.classList.remove('hidden');
625     }
626   });
```

- Line 601: builds the log entry object, stamping the client-side current time as `timestamp` (not a server-assigned time) in ISO format.
- Line 602: only attaches `attributes` to the payload if it was actually parsed (keeps the payload minimal when the field was left blank).
- Lines 604–609: POSTs the entry wrapped in a `{ logs: [entry] }` batch envelope to `/logs`, matching the batch-oriented ingestion API described later in the Docs drawer content.
- Line 610: parses the JSON response body directly (raw `fetch`, not `fetchJSON`, since this code needs to distinguish acceptance/rejection details rather than just null-on-failure).
- Lines 611–617: on success (`data.accepted > 0`), shows a success toast (via the optional-chained `window.showToast?.(...)`, guarding against the toast system not being initialized), closes the modal, clears the three input fields (leaving the Level select at whatever it was — not reset to `info`), and, if the current page has defined a global `window.refreshLogsExplorer` function, calls it — this is how the modal notifies a live logs table/stream to refresh after a manual log is added, without this shared file needing to know anything about that page's internal rendering logic.
- Lines 618–621: on a non-accepted response, shows the server-provided rejection reason (`data.rejected?.[0]?.reason`, i.e. the first rejected entry's reason) or a generic fallback message.
- Lines 622–625: any network-level failure (e.g. `fetch` throwing, or `.json()` failing) is caught and shown as a generic "Failed to reach the server" error.

#### Drawer scaffolding: backdrop, Docs drawer, Support drawer (lines 628–800)

```js
629   const backdrop = document.createElement('div');
630   backdrop.className = 'drawer-overlay';
631   document.body.appendChild(backdrop);
```

Creates the single shared dark backdrop element (styled by `.drawer-overlay` from the injected CSS) used behind both the Docs and Support drawers.

```js
634   const docsDrawer = document.createElement('div');
635   docsDrawer.className = 'custom-drawer';
636   docsDrawer.id = 'shared-docs-drawer';
637   docsDrawer.innerHTML = `...`;
737   document.body.appendChild(docsDrawer);
```

Builds the Docs drawer: a header (icon, "Documentation" title, close button with class `close-drawer-btn`) and a body containing a search input (`#docs-search-input`, with an absolutely positioned search icon overlapping its left padding) followed by an accordion list (`#docs-accordion`) of five static `.doc-section` cards, each with a `.doc-section-header` (title + `expand_more` chevron icon) and a `.doc-section-content` (the actual documentation text/code). The five sections, hard-coded directly in this file, are: "Getting Started & Architecture" (lines 654–663, describing TimescaleDB-backed ingestion/analytics and retention/uptime tracking), "Log Ingestion API (POST /logs)" (lines 665–687, showing a sample POST body matching the schema the Add Log modal itself builds), "Log Query API (GET /logs)" (lines 689–705, documenting `service`, `level`, `q`, and `attr.key` query parameters), "ObsidianQL Search Syntax" (lines 707–721, documenting `status:`, `level:`, `service:` selector syntax for the Logs Explorer's search bar), and "Retention Policy Rules" (lines 723–732, describing the hourly retention script, the default 30-day/`RETENTION_DAYS` window, and the manual "Run Retention" trigger button elsewhere in the app). This content is purely static reference text baked into the JS bundle — it is not fetched from any API.

```js
740   const supportDrawer = document.createElement('div');
741   supportDrawer.className = 'custom-drawer';
742   supportDrawer.id = 'shared-support-drawer';
743   supportDrawer.innerHTML = `...`;
773   document.body.appendChild(supportDrawer);
```

Builds the Support drawer similarly: a header showing an "AI Support Desk" title with a small pulsing green dot and "Agent Online" label (purely decorative — not tied to any real connectivity check), and a body containing a `chat-container` with a scrollable message list (`#support-chat-messages`, pre-seeded with one bot greeting bubble) and an input row (`#support-chat-input` text field plus `#send-chat-btn` button).

```js
776   function closeAllDrawers() {
777     backdrop.classList.remove('active');
778     docsDrawer.classList.remove('active');
779     supportDrawer.classList.remove('active');
780   }
781   backdrop.addEventListener('click', closeAllDrawers);
782   document.querySelectorAll('.close-drawer-btn').forEach(btn => {
783     btn.addEventListener('click', closeAllDrawers);
784   });
```

`closeAllDrawers` deactivates the backdrop and both drawers at once (rather than tracking which one is open — simpler, since only one is ever meant to be open at a time). It's wired to the backdrop's own click (clicking outside either drawer closes whichever is open) and to every element carrying the shared `close-drawer-btn` class (both drawers' header close buttons, matched via a single `querySelectorAll` since the class is shared).

```js
787   function openDocsDrawer() {
788     closeAllDrawers();
789     backdrop.classList.add('active');
790     docsDrawer.classList.add('active');
791     document.getElementById('docs-search-input').focus();
792   }
793
794   function openSupportDrawer() {
795     closeAllDrawers();
796     backdrop.classList.add('active');
797     supportDrawer.classList.add('active');
798     document.getElementById('support-chat-input').focus();
799   }
```

Each open function first calls `closeAllDrawers()` (defensively ensuring the other drawer isn't left open simultaneously), then activates the backdrop and its own drawer, then focuses that drawer's primary input (search box for Docs, chat box for Support) for immediate typing.

#### Docs search and accordion behavior (lines 802–839)

```js
803   const docSearch = document.getElementById('docs-search-input');
804   docSearch.addEventListener('input', function () {
805     const q = this.value.toLowerCase().trim();
806     const sections = document.querySelectorAll('#docs-accordion .doc-section');
807     sections.forEach(sec => {
808       const headerText = sec.querySelector('.doc-section-header').textContent.toLowerCase();
809       const contentText = sec.querySelector('.doc-section-content').textContent.toLowerCase();
810       if (!q || headerText.includes(q) || contentText.includes(q)) {
811         sec.style.display = 'block';
812         if (q) {
813           // auto expand matched items
814           sec.querySelector('.doc-section-content').classList.remove('hidden');
815           sec.querySelector('.material-symbols-outlined').textContent = 'expand_less';
816         }
817       } else {
818         sec.style.display = 'none';
819       }
820     });
821   });
```

Live-filters the Docs accordion as the user types:
- Line 805: normalizes the query to lowercase and trims whitespace.
- Lines 806–809: for every doc section, grabs both the header's and the content's plain text (case-folded) to search against.
- Line 810: a section is kept visible if the query is empty (`!q`, i.e. show everything when the search box is cleared) or if the query substring appears in either the header or the content text.
- Lines 811–816: when shown due to a non-empty match, the section is also force-expanded — its `.doc-section-content` has `.hidden` removed and its chevron icon is switched to `expand_less` — so matching results are immediately readable without an extra click. This directly overrides whatever collapsed/expanded state the accordion click-toggle (below) had left it in.
- Lines 817–819: non-matching sections are hidden entirely via inline `display: none` (note: this uses inline style, not a class, so it's independent of/wins over the `.doc-section-content.hidden` class toggling used for the accordion body — this hides the *whole section* including its header).

```js
824   document.querySelectorAll('#docs-accordion .doc-section-header').forEach(hdr => {
825     hdr.addEventListener('click', function () {
826       const content = this.nextElementSibling;
827       const icon = this.querySelector('.material-symbols-outlined');
828       const isHidden = content.classList.contains('hidden');
829       if (isHidden) {
830         content.classList.remove('hidden');
831         icon.textContent = 'expand_less';
832       } else {
833         content.classList.add('hidden');
834         icon.textContent = 'expand_more';
835       }
836     });
837     // Start collapsed by default
838     hdr.nextElementSibling.classList.add('hidden');
839   });
```

Standard accordion toggle behavior, set up once for each header at drawer-construction time:
- Line 826: relies on the DOM structure where `.doc-section-content` is always the header's `nextElementSibling` within the same `.doc-section` — no id lookups needed.
- Lines 828–835: toggles the `.hidden` class on the content and flips the chevron glyph between `expand_more` (collapsed) and `expand_less` (expanded) to match.
- Line 838: immediately after attaching the click listener, each section's content is force-collapsed (`.hidden` added) so the accordion starts fully closed on drawer creation, regardless of the `display: block` set inline in the markup — this line runs once at IIFE-execution time, not on every drawer open.

#### Support chat behavior (lines 841–888)

```js
842   const chatMessages = document.getElementById('support-chat-messages');
843   const chatInput = document.getElementById('support-chat-input');
844
845   function appendChatBubble(text, isUser = false) {
846     const bubble = document.createElement('div');
847     bubble.className = `chat-bubble ${isUser ? 'bubble-user' : 'bubble-bot'}`;
848     bubble.textContent = text;
849     chatMessages.appendChild(bubble);
850     chatMessages.scrollTop = chatMessages.scrollHeight;
851   }
```

`appendChatBubble` creates one chat bubble, styling it as `bubble-user` (right-aligned, white) or `bubble-bot` (left-aligned, dark) based on the `isUser` flag (defaulting to bot). Crucially, it uses `textContent` (not `innerHTML`) to set the bubble's text — unlike most other rendering functions in this file, chat message content here is not HTML-interpolated raw, avoiding an XSS vector for user-typed or server-returned chat text. Line 850 scrolls the message list to the bottom after every append, keeping the latest message in view.

```js
853   function handleSupportSend() {
854     const val = chatInput.value.trim();
855     if (!val) return;
856     appendChatBubble(val, true);
857     chatInput.value = '';
858
859     const typing = document.createElement('div');
860     typing.className = 'chat-bubble bubble-bot italic opacity-50';
861     typing.id = 'chat-typing-status';
862     typing.textContent = 'Support Agent is typing...';
863     chatMessages.appendChild(typing);
864     chatMessages.scrollTop = chatMessages.scrollHeight;
```

- Lines 854–855: ignores empty/whitespace-only input.
- Line 856: immediately echoes the user's message as a right-aligned bubble.
- Line 857: clears the input field for the next message.
- Lines 859–864: appends a temporary "Support Agent is typing..." bot bubble (italic, dimmed via `opacity-50`) tagged with id `chat-typing-status`, giving immediate feedback while the network request is in flight, and scrolls it into view.

```js
866     fetch('/support/chat', {
867       method: 'POST',
868       headers: { 'Content-Type': 'application/json' },
869       body: JSON.stringify({ message: val }),
870     })
871       .then(async r => {
872         if (!r.ok) throw new Error('support agent unavailable');
873         return r.json();
874       })
875       .then(data => {
876         typing.remove();
877         appendChatBubble(data.reply || "Sorry, I couldn't process that.", false);
878       })
879       .catch(() => {
880         typing.remove();
881         appendChatBubble("Support agent is currently unavailable. Please try again later.", false);
882       });
883   }
```

- Lines 866–870: POSTs `{ message: val }` to `/support/chat` (this is a promise-chain style, `.then`/`.catch`, unlike the `async/await` style used in the Add Log submit handler and `fetchJSON` — the file mixes both idioms).
- Lines 871–873: a non-2xx response is explicitly turned into a thrown error (since `fetch` doesn't reject on HTTP error statuses by default), routing it to the `.catch` below.
- Lines 875–877: on success, removes the typing indicator and appends the bot's real reply (`data.reply`), falling back to a generic "couldn't process that" message if the server didn't include a `reply` field.
- Lines 879–882: on any failure (network error or the thrown "unavailable" error), removes the typing indicator and shows a generic unavailable message instead — the user never sees the typing bubble stuck indefinitely.

```js
885   document.getElementById('send-chat-btn').addEventListener('click', handleSupportSend);
886   chatInput.addEventListener('keydown', function (e) {
887     if (e.key === 'Enter') handleSupportSend();
888   });
```

Wires the Send button's click and the input's Enter keypress to the same `handleSupportSend` handler, so the chat can be driven either by mouse or keyboard.

#### Sidebar binding (lines 890–930)

```js
891   function bindSidebar() {
892     // Find all sidebar links
893     const sidebarAnchors = document.querySelectorAll('aside a, aside button');
894     sidebarAnchors.forEach(el => {
895       const text = el.textContent.trim();
896       const hasDocs = text.includes('Docs') || el.querySelector('[data-icon="menu_book"]') || el.querySelector('.material-symbols-outlined')?.textContent.includes('menu_book');
897       const hasSupport = text.includes('Support') || el.querySelector('[data-icon="support_agent"]') || el.querySelector('.material-symbols-outlined')?.textContent.includes('support_agent');
```

`bindSidebar` locates the page's own static sidebar links/buttons (any `<a>` or `<button>` inside an `<aside>` element — this file doesn't create the sidebar itself, only reacts to whatever markup a given page already has) and, for each, decides whether it's a "Docs" or "Support" trigger by three heuristics ORed together: its visible text contains the word "Docs"/"Support", it contains a child with `data-icon="menu_book"`/`"support_agent"`, or it contains a Material Symbols span whose icon glyph text matches. This redundant matching is a defensive way to recognize the intended sidebar entries across pages that might mark them up slightly differently (text label vs. icon-only, different attributes).

```js
899       if (hasDocs) {
900         el.removeAttribute('href');
901         el.style.cursor = 'pointer';
902         el.addEventListener('click', (e) => {
903           e.preventDefault();
904           openDocsDrawer();
905         });
906       }
907
908       if (hasSupport) {
909         el.removeAttribute('href');
910         el.style.cursor = 'pointer';
911         el.addEventListener('click', (e) => {
912           e.preventDefault();
913           openSupportDrawer();
914         });
915       }
916     });
```

For a matched Docs link: strips any `href` (so it's no longer a real navigation target, avoiding an actual page jump or a `#` scroll-jump if it was an anchor placeholder), sets the cursor to `pointer` (since it may no longer look clickable once the underlying `href` semantics are gone — restoring the affordance manually), and binds a click handler that prevents the default action and opens the Docs drawer. The Support branch mirrors this exactly, opening the Support drawer instead. Both `if`s are independent (not `else if`), so a single element could theoretically satisfy both conditions if its markup were ambiguous, though in practice each sidebar item would be expected to match at most one.

```js
918     // Bind Add Log button
919     document.getElementById('add-log-btn')?.addEventListener('click', (e) => {
920       e.preventDefault();
921       openAddLogModal();
922     });
923   }
```

Separately (not part of the `aside a, aside button` loop), looks for a single element with id `add-log-btn` anywhere on the page and, if present (optional chaining guards its absence), wires it to prevent default and open the Add Log modal.

```js
925   if (document.readyState === 'loading') {
926     document.addEventListener('DOMContentLoaded', bindSidebar);
927   } else {
928     bindSidebar();
929   }
930 })();
```

The only DOM-ready guard in the entire IIFE: since `bindSidebar` needs to query page-specific sidebar markup that may not exist yet if this script is loaded in the `<head>` before the body is parsed, it checks `document.readyState`. If the document is still `'loading'`, it defers `bindSidebar` to the `DOMContentLoaded` event; otherwise (script loaded at the end of body, or after the DOM is already ready), it calls `bindSidebar` immediately. Notably, everything *before* this point in the IIFE (CSS injection, toast container, Add Log modal creation, both drawers, all their event listeners) runs synchronously and unconditionally as soon as the script executes, without waiting for `DOMContentLoaded` — those all only touch `document.head`/`document.body`, which are always available for `appendChild` even during early parsing, whereas `bindSidebar` specifically needs the page's own already-rendered `<aside>` sidebar content to exist.

This closes the IIFE at line 930; line 931 is a trailing blank line at end of file.
