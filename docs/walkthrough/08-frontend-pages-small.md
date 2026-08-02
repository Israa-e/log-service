## public/index.html

This is the smallest page in the app: a bare-bones client-side router with no visible UI. A browser lands here only if something requests `/index.html` (or the bare `/` path) directly as a static file — note that the server's own `/` route in `src/app.ts` (`app.get("/", (req, res) => res.redirect("/logs-explorer"))`) never actually serves this file for a normal navigation to `/`, so in practice this page is a fallback/legacy entry point rather than something users click into. Its only job is to ask the server whether the current session is authenticated and bounce to the right place.

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Obsidian Log Engine</title>
</head>
```
Lines 1-6. A minimal, unstyled document shell — no `lang` attribute, no viewport meta, no stylesheet or font links, unlike every other page covered below. That's consistent with this file never actually rendering visible content; it exists purely to run one script and redirect away.

```html
<body>
  <script>
```
Lines 7-8. Opens the body and an inline script block — there is no other markup in the body at all.

```js
    fetch('/auth/session')
```
Line 9. Issues a `GET` request (fetch's default method) to `/auth/session`, presumably an endpoint that returns a success status when the session cookie is valid and an error status otherwise.

```js
      .then(r => { window.location.href = r.ok ? '/logs-explorer' : '/login.html'; })
```
Line 10. `r.ok` is `true` for any 2xx response. If the session check succeeds, the browser is redirected to `/logs-explorer` (the real authenticated landing page); otherwise it goes to `/login.html`. This is a client-side auth gate — it duplicates, at the browser level, the same authenticated/unauthenticated branching that `checkAuth` middleware enforces server-side for `/logs-explorer`.

```js
      .catch(() => { window.location.href = '/login.html'; });
```
Line 11. Any network-level failure (server down, CORS error, etc.) is treated the same as "not authenticated" and also sends the user to the login page — a safe default that never leaves the user stuck on a blank page.

```html
  </script>
</body>
</html>
```
Lines 12-14. Closes the script, body, and document. No further markup follows.

## public/login.html

This is the credential-entry page users see whenever the server or `index.html`'s session check decides they aren't authenticated. It's a single centered card with a password field — there's no username, matching a single-shared-password auth model. Unlike the other four pages in this walkthrough, it does not load `app.js` or call `initTheme()`, so it always renders in the dark theme baked into its own markup and doesn't participate in the app-wide theme toggle.

```html
<!DOCTYPE html>
<html class="dark" lang="en"><head>
```
Lines 1-2. Standard doctype; the root `<html>` carries `class="dark"` directly in markup (hardcoded, not set by a script), and `lang="en"` for accessibility/SEO — both absent from `index.html`.

```html
<meta charset="UTF-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Obsidian Log Engine — Login</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="tailwind-config.js"></script>
```
Lines 3-7. Charset and responsive viewport meta tags, page title, then the Tailwind Play CDN build (no `?plugins=` query string here, unlike the other pages) followed by the project's own `tailwind-config.js`, which defines the custom design tokens (`bg-surface`, `text-primary`, `font-headline-md`, etc.) used throughout every page.

```html
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Hanken+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="styles.css"/>
```
Lines 8-10. Loads four Google web fonts (Geist for UI text, JetBrains Mono for code/log content, Hanken Grotesk and Inter as additional weights), the Material Symbols Outlined icon font (used via `<span class="material-symbols-outlined">`), and the project's own `styles.css`.

```html
<style>
body { background-color: #020617; color: #dae2fd; font-family: 'Geist', sans-serif; }
html.light body { background-color: #f8f9ff; color: #0b1c30; }
.material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; vertical-align: middle; }
</style></head>
```
Lines 11-15. An inline `<style>` block that hardcodes dark/light background and text colors directly on `body`, plus a `html.light body` override. This duplicates work that `styles.css`/Tailwind's theme tokens already do on the other pages (which just use classes like `bg-background`) — login.html is the only page that inlines these colors itself rather than relying on the shared surface tokens, likely because it's meant to render correctly even before `app.js`/theme classes are involved. The `.material-symbols-outlined` rule (default weight/fill/grade/optical size, and vertical alignment so icons line up with adjacent text) is identical to the rule repeated in every other page in this walkthrough.

```html
<body class="min-h-screen flex items-center justify-center p-4">
```
Line 16. Unlike the sidebar-layout pages below, login.html centers a single card both vertically and horizontally in the viewport using flexbox, with `min-h-screen` ensuring it fills the screen even with little content.

```html
  <div class="bg-surface border border-outline-variant rounded p-8 w-full max-w-sm space-y-6">
```
Line 17. The login card itself: themed surface background, a subtle border, rounded corners, generous padding, and `max-w-sm` capping its width so it doesn't stretch on wide screens. `space-y-6` adds vertical gaps between its direct children.

```html
    <div class="text-center space-y-2">
      <div class="w-12 h-12 bg-primary rounded flex items-center justify-center mx-auto"><span class="material-symbols-outlined text-background text-2xl" style="font-variation-settings:'FILL'1">layers</span></div>
      <h1 class="font-headline-md text-headline-md font-bold text-primary">Obsidian Log</h1>
      <p class="text-body-md text-on-surface-variant">v2.4.0-stable</p>
    </div>
```
Lines 18-22. The branding header: a centered square badge (`bg-primary`) containing a "layers" Material Symbol icon rendered in the solid/filled variant via the inline `style="font-variation-settings:'FILL'1"` override (overriding the default `FILL 0` set in the `<style>` block above) and colored `text-background` so the icon reads as a cutout against the primary-colored square; then the app name as an `h1` in the primary color, and a static version string below it.

```html
    <div class="space-y-4">
      <div><label class="text-label-caps text-on-surface-variant block mb-1">Password</label><input id="password" type="password" class="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2.5 text-body-md text-primary placeholder:text-on-surface-variant/50 focus:outline-none focus:border-secondary transition-all" placeholder="Enter your password"></div>
```
Lines 23-24. The single form field: a small caps label followed by a password-type `<input id="password">`. Its Tailwind classes style the field's background, border, padding, and placeholder color, and swap the border to `focus:border-secondary` while suppressing the default focus ring (`focus:outline-none`) for a custom focus treatment.

```html
      <p id="error" class="text-error text-code-sm hidden">Wrong password</p>
```
Line 25. An error message paragraph, styled in the error color, that starts hidden via Tailwind's `hidden` utility class. The login script (below) removes this class to reveal it after a failed attempt.

```html
      <button onclick="doLogin()" class="w-full py-2.5 bg-primary text-on-primary font-bold rounded hover:opacity-90 active:scale-[0.98] transition-all text-body-md">Sign In</button>
```
Line 26. The submit button. It wires up `doLogin()` via an inline `onclick` attribute rather than an `addEventListener` call — the only place on this page that mixes both styles (the Enter-key handler below uses `addEventListener`). `active:scale-[0.98]` gives a subtle press animation on click.

```html
    </div>
  </div>
  <script>
```
Lines 27-29. Closes the field-group `div` and the card `div`, then opens the page's inline script.

```js
    async function doLogin() {
      const btn = document.querySelector('button');
      btn.disabled = true;
```
Lines 30-32. Declares the async login handler. `document.querySelector('button')` grabs the *first* `<button>` on the page — a selector that only works safely because this page has exactly one button; it's then immediately disabled to prevent the user from double-submitting while the request is in flight.

```js
      try {
        const password = document.getElementById("password").value;
        const res = await fetch("/auth/login", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password })
        });
```
Lines 33-38. Reads the current value of the password input, then `POST`s it as JSON to `/auth/login`. This is wrapped in a `try` so that any thrown error (network failure, etc.) still falls through to the `finally` block below and re-enables the button.

```js
        if (res.ok) { window.location.href = "/logs-explorer"; }
        else { document.getElementById("error").classList.remove("hidden"); }
      } finally { btn.disabled = false; }
    }
```
Lines 39-42. On a successful (2xx) response, the browser navigates straight to `/logs-explorer`. On failure, the hidden `#error` paragraph is revealed by removing its `hidden` class — the "Wrong password" text becomes visible with no distinction between wrong-password and other error causes. The `finally` re-enables the submit button in either case (a no-op on success, since the page is about to navigate away, but relevant if the fetch throws or the login is rejected).

```js
    document.getElementById("password").addEventListener("keypress", e => { if (e.key === "Enter") doLogin(); });
```
Line 43. Lets the user submit by pressing Enter in the password field instead of clicking the button, by listening for `keypress` and checking `e.key === "Enter"`.

```html
  </script>
</body></html>
```
Lines 44-45. Closes the script and the document.

## public/support.html

This is the static "Support" page reachable via the sidebar's Support link (`/support`, served directly and unauthenticated by `app.get("/support", ...)` in `src/app.ts`, unlike `/logs-explorer`/`/analytics`/`/retention` which pass through `checkAuth`). It's built on the same full-height sidebar-plus-main-content app shell as `docs.html` and `dashboard.html`, and shows purely static contact/status information — nothing on this page issues an API call or reads dynamic data.

```html
<!DOCTYPE html>
<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Obsidian Log Engine — Support</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<script src="tailwind-config.js"></script>
```
Lines 1-7. Same doctype/root-class/viewport pattern as `login.html`, but the Tailwind CDN URL here (and in `docs.html`/`dashboard.html`) requests the `forms` and `container-queries` plugins via query string — plugins `login.html` doesn't load, since it has no form controls beyond the one styled input.

```html
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Hanken+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="styles.css"/>
<style>
.material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; vertical-align: middle; }
</style></head>
```
Lines 8-13. Same font/stylesheet links as `login.html`. The inline `<style>` block here only sets the Material Symbols default variation settings — there's no hardcoded body background override like in `login.html`, since this page relies entirely on the `bg-background`/`bg-surface` theme classes from `tailwind-config.js` plus `initTheme()` (called later) to pick the right colors.

```html
<body class="flex h-screen overflow-hidden">
```
Line 14. The app-shell body: a full-viewport-height flex row (sidebar + main), with `overflow-hidden` so only inner panels scroll, not the page itself.

```html
<aside class="w-[240px] h-screen fixed left-0 top-0 border-r border-outline-variant bg-surface flex flex-col py-panel-padding z-50">
```
Line 15. A fixed-position sidebar pinned to the left edge, exactly 240px wide and full viewport height, laid out as a vertical flex column.

```html
  <div class="px-4 mb-8">
    <div class="flex items-center gap-3 mb-1">
      <div class="w-8 h-8 bg-primary rounded flex items-center justify-center"><span class="material-symbols-outlined text-background" style="font-variation-settings:'FILL'1">layers</span></div>
      <h1 class="font-headline-md text-headline-md font-bold tracking-tighter text-primary">Obsidian Log</h1>
    </div>
    <p class="font-body-md text-code-sm text-on-surface-variant opacity-60">v2.4.0-stable</p>
  </div>
```
Lines 16-22. The sidebar's brand header: the same "layers" icon badge as `login.html` (again forced to the filled variant inline), the app name, and a faded version string — this exact block reappears verbatim in `docs.html` and `dashboard.html`.

```html
  <nav class="flex-1 space-y-1 px-2">
    <a href="/logs-explorer" class="flex items-center gap-3 px-3 py-2 rounded text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-colors"><span class="material-symbols-outlined">terminal</span><span class="font-body-md text-body-md">Logs</span></a>
    <a href="/analytics" class="flex items-center gap-3 px-3 py-2 rounded text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-colors"><span class="material-symbols-outlined">analytics</span><span class="font-body-md text-body-md">Metrics</span></a>
    <a href="/retention" class="flex items-center gap-3 px-3 py-2 rounded text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-colors"><span class="material-symbols-outlined">history</span><span class="font-body-md text-body-md">Retention</span></a>
  </nav>
```
Lines 23-27. The primary nav: three icon+label links (Logs/terminal, Metrics/analytics, Retention/history), each identically styled — plain `text-on-surface-variant` that highlights to `text-primary` with a background tint on hover. None of them carry an "active" treatment on this page, since Support is neither of these three sections.

```html
  <div class="px-4 mt-auto space-y-4">
    <button id="add-log-btn" type="button" class="w-full py-2 bg-primary text-on-primary font-bold rounded hover:opacity-90 transition-all flex items-center justify-center gap-2 cursor-pointer"><span class="material-symbols-outlined text-[18px]">post_add</span>Add Log</button>
```
Lines 28-29. `mt-auto` pushes this block to the bottom of the flex column. The "Add Log" button (`id="add-log-btn"`) has no inline handler in this markup — it's bound by `app.js`'s `bindSidebar()` IIFE, which attaches a click listener that calls `openAddLogModal()`, opening a modal (also injected by `app.js`) to POST a manual log entry to `/logs`.

```html
    <div class="pt-4 border-t border-outline-variant space-y-1">
      <a href="/docs" class="flex items-center gap-3 px-3 py-1.5 rounded text-on-surface-variant hover:text-primary transition-colors"><span class="material-symbols-outlined">menu_book</span><span class="font-body-md text-body-md">Docs</span></a>
      <a href="/support" class="flex items-center gap-3 px-3 py-1.5 rounded text-secondary font-bold transition-colors"><span class="material-symbols-outlined">support_agent</span><span class="font-body-md text-body-md">Support</span></a>
    </div>
```
Lines 30-33. A secondary nav group above the profile block: Docs and Support links. Here the Support link is styled `text-secondary font-bold` (bold, accent-colored) to indicate it's the current page, while Docs stays in the muted default state — the same pair appears in `docs.html` with the roles reversed. Note that `app.js`'s `bindSidebar()` also strips the `href` from any sidebar element whose text includes "Docs" or "Support" and rebinds its click to open a floating drawer (`openDocsDrawer()`/`openSupportDrawer()`) instead — so clicking "Support" here, even while already on `/support`, opens the AI chat drawer rather than reloading this static page.

```html
    <div class="flex items-center gap-3 mt-4 px-2">
      <img class="w-8 h-8 rounded-full border border-outline-variant" alt="Admin" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAyf0i83qAiUFyjaJaor7SyDewQlnItHxNdOK9zpoFlBY0Ir6v-Z_o4TH-uWQIoX39jOTXokQxPS-uxWaz7BdTfE5HoaVbQNk-DibBP_TMKupJ_jmMV5IG6ednbeHWwOvAos0M9oAP56Cr8RE_v5TijB8pWGP_7sL4MIthzJ2-qnT4kjdFq6ITWsTq7q0dRZsRvltD6sGaFF7GVwrrLHmMBMC11exGIrQ4lLir-eM0aqcLx6WzfgSn9"/>
      <div class="overflow-hidden"><p class="text-[12px] font-bold truncate">Admin Root</p><p class="text-[10px] text-on-surface-variant truncate">cluster-admin-01</p></div>
    </div>
  </div>
</aside>
```
Lines 34-39. A static "logged in as" footer: a hardcoded external avatar image URL, a hardcoded name ("Admin Root") and hardcoded id string ("cluster-admin-01") — none of this is fetched from the server; it's identical hardcoded markup on every sidebar page.

```html
<main class="flex-1 ml-[240px] flex flex-col h-screen bg-background">
  <header class="h-16 flex justify-between items-center px-panel-padding bg-surface border-b border-outline-variant z-40">
    <div class="flex items-center gap-6">
      <span class="text-label-caps text-on-surface-variant">SUPPORT</span>
    </div>
```
Lines 40-44. The main content column, offset by `ml-[240px]` to sit to the right of the fixed sidebar. Its top bar shows a static section label, "SUPPORT", in small caps.

```html
    <div class="flex items-center gap-4">
      <button class="p-1.5 text-on-surface-variant hover:text-secondary transition-all" onclick="toggleTheme()"><span class="material-symbols-outlined" id="theme-icon">light_mode</span></button>
    </div>
  </header>
```
Lines 45-48. The only header control on this page is the theme toggle button, calling `toggleTheme()` (defined in `app.js`), which flips the `dark`/`light` classes on `<html>`, persists the choice to `localStorage`, and updates the icon (`id="theme-icon"`) between `light_mode`/`dark_mode` glyphs.

```html
  <div class="flex-1 overflow-auto p-panel-padding space-y-6">
    <div class="bg-surface border border-outline-variant rounded p-6">
      <h1 class="font-headline-md font-bold text-primary mb-6">Support</h1>
      <div class="grid grid-cols-2 gap-4">
```
Lines 49-52. The scrollable content region, containing one card with the page heading and a 2-column grid for the contact options below.

```html
        <div class="bg-surface-container-low rounded p-4 flex items-start gap-3"><span class="material-symbols-outlined text-secondary">mail</span><div><h3 class="text-body-md font-bold text-primary">Email</h3><p class="text-code-sm text-on-surface-variant">support@obsidian.io</p></div></div>
        <div class="bg-surface-container-low rounded p-4 flex items-start gap-3"><span class="material-symbols-outlined text-secondary">chat</span><div><h3 class="text-body-md font-bold text-primary">Live Chat</h3><p class="text-code-sm text-on-surface-variant">Available 24/7 for premium nodes</p></div></div>
        <div class="bg-surface-container-low rounded p-4 flex items-start gap-3"><span class="material-symbols-outlined text-secondary">description</span><div><h3 class="text-body-md font-bold text-primary">Knowledge Base</h3><p class="text-code-sm text-on-surface-variant">Troubleshooting guides &amp; FAQs</p></div></div>
        <div class="bg-surface-container-low rounded p-4 flex items-start gap-3"><span class="material-symbols-outlined text-secondary">bug_report</span><div><h3 class="text-body-md font-bold text-primary">Report an Issue</h3><p class="text-code-sm text-on-surface-variant">File a bug report on GitHub</p></div></div>
```
Lines 53-56. Four identically-structured static tiles (icon + heading + one line of description): Email (`support@obsidian.io`), Live Chat, Knowledge Base, and Report an Issue. None of these are links or buttons — they're purely informational text, not wired to any action (e.g. the "Live Chat" tile doesn't open the AI chat drawer that `app.js` provides; that's only triggered from the sidebar's Support link).

```html
      </div>
      <div class="mt-6 bg-surface-container-low rounded p-4"><h3 class="text-body-md font-bold text-primary mb-2">System Status</h3><div class="flex items-center gap-2 text-secondary"><span class="w-2 h-2 rounded-full bg-secondary"></span><span class="text-code-sm font-bold">All systems operational</span></div></div>
    </div>
  </div>
</main>
```
Lines 57-61. Closes the contact-tile grid, then adds a "System Status" panel below it with a small colored dot and the static text "All systems operational" — this is not driven by any health-check API call; it's hardcoded to always show green/operational.

```html
<script src="app.js"></script>
<script>initTheme();</script>
</body></html>
```
Lines 62-64. Loads the shared `app.js` (theme functions, `fetchJSON`, the dynamically-injected Add Log modal, Docs/Support drawers, notifications, toasts), then immediately calls `initTheme()` to apply the saved or OS-preferred theme and sync the `#theme-icon` glyph before the page is shown.

## public/docs.html

This is the static API reference page, served directly and unauthenticated via `app.get("/docs", ...)` in `src/app.ts`. It shares the exact sidebar/header app-shell structure as `support.html` (down to nearly identical markup for the aside and header), differing mainly in which nav item is highlighted and in the main content, which lists the service's HTTP endpoints with example requests instead of contact tiles.

```html
<!DOCTYPE html>
<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Obsidian Log Engine — Docs</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<script src="tailwind-config.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Hanken+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="styles.css"/>
<style>
.material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; vertical-align: middle; }
</style></head>
<body class="flex h-screen overflow-hidden">
```
Lines 1-14. Byte-for-byte the same head/body-open boilerplate as `support.html` — same title suffix change aside ("— Docs" vs "— Support"), same Tailwind CDN plugin query, same font links, same icon-font style override, same flex app-shell body.

```html
<aside class="w-[240px] h-screen fixed left-0 top-0 border-r border-outline-variant bg-surface flex flex-col py-panel-padding z-50">
  <div class="px-4 mb-8"> ... </div>
  <nav class="flex-1 space-y-1 px-2"> ... </nav>
```
Lines 15-27. The sidebar shell, brand header, and Logs/Metrics/Retention nav are identical in markup to `support.html` (lines 15-27 there) — same icons, same hover styling, none marked active since neither Logs, Metrics, nor Retention is the current section.

```html
  <div class="px-4 mt-auto space-y-4">
    <button id="add-log-btn" ...>Add Log</button>
    <div class="pt-4 border-t border-outline-variant space-y-1">
      <a href="/docs" class="flex items-center gap-3 px-3 py-1.5 rounded text-secondary font-bold transition-colors"><span class="material-symbols-outlined">menu_book</span><span class="font-body-md text-body-md">Docs</span></a>
      <a href="/support" class="flex items-center gap-3 px-3 py-1.5 rounded text-on-surface-variant hover:text-primary transition-colors"><span class="material-symbols-outlined">support_agent</span><span class="font-body-md text-body-md">Support</span></a>
    </div>
```
Lines 28-33. The one meaningful difference from `support.html`'s equivalent block: here it's the **Docs** link that carries `text-secondary font-bold` (marking it as the active page) while **Support** is left in the muted hover-only state — the roles are exactly swapped from `support.html`. As on the Support page, `app.js`'s `bindSidebar()` intercepts clicks on both of these links and opens the corresponding drawer (`openDocsDrawer()`/`openSupportDrawer()`) rather than letting them navigate normally.

```html
    <div class="flex items-center gap-3 mt-4 px-2">
      <img class="w-8 h-8 rounded-full border border-outline-variant" alt="Admin" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAyf0i83qAiUFyjaJaor7SyDewQlnItHxNdOK9zpoFlBY0Ir6v-Z_o4TH-uWQIoX39jOTXokQxPS-uxWaz7BdTfE5HoaVbQNk-DibBP_TMKupJ_jmMV5IG6ednbeHWwOvAos0M9oAP56Cr8RE_v5TijB8pWGP_7sL4MIthzJ2-qnT4kjdFq6ITWsTq7q0dRZsRvltD6sGaFF7GVwrrLHmMBMC11exGIrQ4lLir-eM0aqcLx6WzfgSn9"/>
      <div class="overflow-hidden"><p class="text-[12px] font-bold truncate">Admin Root</p><p class="text-[10px] text-on-surface-variant truncate">cluster-admin-01</p></div>
    </div>
  </div>
</aside>
```
Lines 34-39. Same hardcoded admin avatar/name footer as every other sidebar page.

```html
<main class="flex-1 ml-[240px] flex flex-col h-screen bg-background">
  <header class="h-16 flex justify-between items-center px-panel-padding bg-surface border-b border-outline-variant z-40">
    <div class="flex items-center gap-6">
      <span class="text-label-caps text-on-surface-variant">DOCS</span>
    </div>
    <div class="flex items-center gap-4">
      <button class="p-1.5 text-on-surface-variant hover:text-secondary transition-all" onclick="toggleTheme()"><span class="material-symbols-outlined" id="theme-icon">light_mode</span></button>
    </div>
  </header>
```
Lines 40-48. Same header pattern as `support.html`, with the section label swapped to "DOCS" and the same lone theme-toggle button.

```html
  <div class="flex-1 overflow-auto p-panel-padding space-y-6">
    <div class="bg-surface border border-outline-variant rounded p-6">
      <h1 class="font-headline-md font-bold text-primary mb-4">API Documentation</h1>
      <div class="space-y-4">
```
Lines 49-52. The scrollable content region opens with a single card headed "API Documentation" and a vertically-stacked list of endpoint entries.

```html
        <div class="bg-surface-container-low rounded p-4"><h3 class="text-body-md font-bold text-primary mb-2">POST /logs</h3><p class="text-code-sm text-on-surface-variant mb-2">Ingest log entries.</p><pre class="bg-surface-container-highest rounded p-3 text-code-sm text-on-surface overflow-x-auto">curl -X POST /logs \
  -H "Content-Type: application/json" \
  -d '{ "logs": [{ "service": "checkout", "level": "info", "message": "hello", "attributes": {"userId": 42} }] }'</pre></div>
```
Line 53-55. First endpoint entry: `POST /logs`, described as "Ingest log entries", followed by a `<pre>` block with a ready-to-copy `curl` example showing the expected JSON shape — a `logs` array of objects with `service`, `level`, `message`, and an `attributes` object.

```html
        <div class="bg-surface-container-low rounded p-4"><h3 class="text-body-md font-bold text-primary mb-2">GET /logs</h3><p class="text-code-sm text-on-surface-variant mb-2">Query logs with filters.</p><pre class="bg-surface-container-highest rounded p-3 text-code-sm text-on-surface overflow-x-auto">GET /logs?service=checkout&level=error&since=2026-01-01T00:00:00Z&limit=50</pre></div>
```
Line 56. Second entry: `GET /logs`, "Query logs with filters", with an example query string demonstrating the `service`, `level`, `since`, and `limit` parameters.

```html
        <div class="bg-surface-container-low rounded p-4"><h3 class="text-body-md font-bold text-primary mb-2">GET /logs/aggregate</h3><p class="text-code-sm text-on-surface-variant mb-2">Aggregate logs by time buckets.</p><pre class="bg-surface-container-highest rounded p-3 text-code-sm text-on-surface overflow-x-auto">GET /logs/aggregate?since=...&until=...&bucket=1h&group_by=service</pre></div>
```
Line 57. Third entry: `GET /logs/aggregate`, "Aggregate logs by time buckets", with a template example showing `since`, `until`, `bucket`, and `group_by` parameters — this is the same endpoint `dashboard.html`'s script calls repeatedly for its metrics and cluster-health panels.

```html
        <div class="bg-surface-container-low rounded p-4"><h3 class="text-body-md font-bold text-primary mb-2">POST /logs/retention/run</h3><p class="text-code-sm text-on-surface-variant mb-2">Manually trigger retention cleanup.</p></div>
        <div class="bg-surface-container-low rounded p-4"><h3 class="text-body-md font-bold text-primary mb-2">POST /auth/login</h3><p class="text-code-sm text-on-surface-variant mb-2">Authenticate with password.</p></div>
```
Lines 58-59. Two final entries with no example block, just a one-line description: `POST /logs/retention/run` ("Manually trigger retention cleanup") and `POST /auth/login` ("Authenticate with password") — the same endpoint `login.html`'s `doLogin()` calls.

```html
      </div>
    </div>
  </div>
</main>
<script src="app.js"></script>
<script>initTheme();</script>
</body></html>
```
Lines 60-66. Closes the endpoint list, card, content region, and main column, then loads `app.js` and calls `initTheme()` — identical closing pattern to `support.html`. This page has no page-specific inline script beyond that call; everything shown is static markup.

## public/dashboard.html

This page is a fuller "overview" dashboard (metric tiles, a live log stream, a cluster-health panel, an alert banner) built on the same sidebar app-shell as `docs.html`/`support.html`. It's worth being precise about how it's reached: in `src/app.ts`, `app.get("/dashboard", (req, res) => res.redirect("/logs-explorer"))` means the `/dashboard` route does **not** serve this file — it redirects elsewhere, to `logs-explorer.html`. `dashboard.html` is still present in `public/` and reachable only because `app.use(express.static(PUBLIC))` serves any file in that directory by its literal path (`/dashboard.html`), unauthenticated, with no route or nav link anywhere in the app pointing at that literal path. In other words, this is a page that still lives in the codebase and is functional in isolation, but the live application's redirect and navigation logic route users to `logs-explorer.html` instead — treat what follows as a description of its contents, not of the app's actual main screen.

```html
<!DOCTYPE html>
<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Obsidian Log Engine — Dashboard</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<script src="tailwind-config.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Hanken+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
```
Lines 1-9. Same head boilerplate pattern as `docs.html`/`support.html` (Tailwind CDN with `forms,container-queries` plugins, `tailwind-config.js`, the same four Google font families).

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/echarts/5.4.3/echarts.min.js"></script>
<link rel="stylesheet" href="styles.css"/>
<style>
.material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; vertical-align: middle; }
</style></head>
```
Lines 10-14. This is the one page in this set that also loads the Apache ECharts charting library from a CDN. However, nothing later in this file — neither the markup nor the inline `<script>` at the bottom — ever references an `echarts` global or renders a chart; it's an included-but-unused dependency on this page as written.

```html
<body class="flex h-screen overflow-hidden">
<!-- SideNavBar -->
<aside class="w-[240px] h-screen fixed left-0 top-0 border-r border-outline-variant bg-surface flex flex-col py-panel-padding z-50">
```
Lines 15-17. Same flex app-shell body and fixed 240px sidebar as the other two sidebar pages; this file additionally uses HTML comments (`<!-- SideNavBar -->`, `<!-- Main Content -->`, `<!-- TopAppBar -->`, `<!-- Content Area -->`) to label its major sections — comments not present in `docs.html`/`support.html`.

```html
  <div class="px-4 mb-8"> ... </div>
  <nav class="flex-1 space-y-1 px-2">
    <a href="/logs-explorer" class="flex items-center gap-3 px-3 py-2 rounded text-secondary font-bold bg-surface-container-highest transition-colors"><span class="material-symbols-outlined">terminal</span><span class="font-body-md text-body-md">Logs</span></a>
    <a href="/analytics" class="flex items-center gap-3 px-3 py-2 rounded text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-colors"><span class="material-symbols-outlined">analytics</span><span class="font-body-md text-body-md">Metrics</span></a>
    <a href="/retention" class="flex items-center gap-3 px-3 py-2 rounded text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-colors"><span class="material-symbols-outlined">history</span><span class="font-body-md text-body-md">Retention</span></a>
  </nav>
```
Lines 18-29. Same brand header block as before (omitted here since it's identical), then the primary nav — but here the **Logs** link is the one styled active (`text-secondary font-bold bg-surface-container-highest`, plus a filled background tint that Docs/Support never use), reflecting that this page treats itself as part of the "Logs" section of the app, even though it's actually a distinct overview page.

```html
  <div class="px-4 mt-auto space-y-4">
    <button id="add-log-btn" ...>Add Log</button>
    <div class="pt-4 border-t border-outline-variant space-y-1">
      <a href="/docs" ...>Docs</a>
      <a href="/support" ...>Support</a>
    </div>
    <div class="flex items-center gap-3 mt-4 px-2"> ... </div>
  </div>
</aside>
```
Lines 30-41. Same Add Log button, Docs/Support link pair (neither styled active here), and hardcoded admin-avatar footer as the other sidebar pages.

```html
<!-- Main Content -->
<main class="flex-1 ml-[240px] flex flex-col h-screen bg-background">
  <!-- TopAppBar -->
  <header class="h-16 flex justify-between items-center px-panel-padding bg-surface border-b border-outline-variant z-40">
    <div class="flex items-center gap-3">
      <span class="text-secondary font-bold font-code-sm">Dashboard</span>
    </div>
```
Lines 42-48. The main column and header open as before; the header label here reads "Dashboard" and, unlike the plain caps labels on Docs/Support, is styled `text-secondary font-bold` in a monospace-flavored class (`font-code-sm`).

```html
    <div class="flex items-center gap-4">
      <div class="flex gap-2">
        <button class="px-4 py-1.5 border border-outline-variant text-on-surface-variant font-body-md text-body-md hover:text-primary transition-all">Export CSV</button>
        <button class="px-4 py-1.5 bg-primary text-on-primary font-bold rounded text-body-md hover:opacity-80 active:scale-95 transition-all">Deploy Policy</button>
      </div>
```
Lines 49-53. Two header action buttons, "Export CSV" and "Deploy Policy". Neither has an `id`, `onclick`, or any other hook into the inline script below or into `app.js` — despite `app.js` exporting a ready-made `downloadCSV(filename, headers, rows)` helper, this "Export CSV" button never calls it. Both buttons are visually complete but functionally inert on this page.

```html
      <div class="flex items-center gap-2 border-l border-outline-variant pl-4">
        <button class="p-1.5 text-on-surface-variant hover:text-secondary transition-all" onclick="logout()"><span class="material-symbols-outlined">logout</span></button>
        <button class="p-1.5 text-on-surface-variant hover:text-secondary transition-all" onclick="toggleTheme()"><span class="material-symbols-outlined" id="theme-icon">light_mode</span></button>
      </div>
    </div>
  </header>
```
Lines 54-59. A divider-separated pair of icon-only buttons: logout (`onclick="logout()"`, defined in `app.js` — it `POST`s to `/auth/logout`, ignores any failure, then redirects to `/login.html`) and the same theme toggle used elsewhere. This is the only page of the three sidebar pages in this walkthrough that exposes a logout control in its header.

```html
  <!-- Content Area -->
  <div class="flex-1 overflow-auto p-panel-padding space-y-6">
    <div class="grid grid-cols-4 gap-4" id="metric-cards">
      <div class="bg-surface border border-outline-variant rounded p-5"><div class="flex justify-between items-start"><div class="p-2 rounded bg-surface-container-highest"><span class="material-symbols-outlined text-primary">database</span></div><span class="text-code-sm text-secondary bg-secondary/10 px-2 py-0.5 rounded">15%</span></div><p class="text-label-caps text-on-surface-variant mt-3">Total Logs</p><h3 class="text-headline-md mt-0.5" id="metric-total">—</h3></div>
```
Lines 60-63. A 4-column grid of stat cards (`id="metric-cards"`). The first card, "Total Logs", shows a "database" icon, a hardcoded "15%" pill that is never updated by any script, and a value placeholder (`id="metric-total"`, initial em dash `—`) that the page's `loadMetrics()` function fills in.

```html
      <div class="bg-surface border border-outline-variant rounded p-5"><div class="flex justify-between items-start"><div class="p-2 rounded bg-error/10"><span class="material-symbols-outlined text-error">report_problem</span></div><span class="text-code-sm text-error bg-error/10 px-2 py-0.5 rounded" id="metric-error-count">0h</span></div><p class="text-label-caps text-on-surface-variant mt-3">Errors (1h)</p><h3 class="text-headline-md mt-0.5" id="metric-errors">—</h3></div>
```
Line 64. Second card, "Errors (1h)": an error-colored "report_problem" icon, a badge with `id="metric-error-count"` (initial text "0h", later overwritten with the actual count suffixed "h"), and the big value placeholder `id="metric-errors"`.

```html
      <div class="bg-surface border border-outline-variant rounded p-5"><div class="flex justify-between items-start"><div class="p-2 rounded bg-surface-container-highest"><span class="material-symbols-outlined text-primary">dns</span></div><span class="text-code-sm text-on-surface-variant bg-surface-container-highest px-2 py-0.5 rounded">Active</span></div><p class="text-label-caps text-on-surface-variant mt-3">Services</p><h3 class="text-headline-md mt-0.5" id="metric-services">—</h3></div>
      <div class="bg-surface border border-outline-variant rounded p-5"><div class="flex justify-between items-start"><div class="p-2 rounded bg-secondary/10"><span class="material-symbols-outlined text-secondary">speed</span></div><span class="text-code-sm text-secondary bg-secondary/10 px-2 py-0.5 rounded">LIVE</span></div><p class="text-label-caps text-on-surface-variant mt-3">Ingestion</p><h3 class="text-headline-md mt-0.5" id="metric-ingestion">—</h3></div>
    </div>
```
Lines 65-67. Third card, "Services" (a static "Active" pill, value placeholder `id="metric-services"`), and fourth, "Ingestion" (a static "LIVE" pill, value placeholder `id="metric-ingestion"`). Closes the metric-cards grid.

```html
    <div class="grid grid-cols-12 gap-6">
      <div class="col-span-8 bg-surface border border-outline-variant rounded flex flex-col h-[480px] overflow-hidden">
        <div class="flex justify-between items-center px-4 py-3 border-b border-outline-variant bg-surface-container-low">
          <div class="flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-secondary animate-pulse" id="live-dot"></span><h3 class="text-body-md font-bold text-primary">Live Log Stream</h3></div>
          <span class="text-code-sm text-on-surface-variant" id="stream-count">0 logs</span>
        </div>
```
Lines 68-73. A 12-column grid row holding two fixed-height (`h-[480px]`) panels. The left one (`col-span-8`, "Live Log Stream") has a header with a pulsing dot (`id="live-dot"`, already animated via Tailwind's `animate-pulse` class) and a count label `id="stream-count"` (initial "0 logs").

```html
        <div class="flex-1 overflow-y-auto font-code-sm bg-surface-container-lowest/50 p-4 space-y-0.5" id="log-stream"><p class="text-on-surface-variant text-code-sm">Loading...</p></div>
```
Line 74. The scrollable stream body, `id="log-stream"`, initially showing a "Loading..." placeholder that `loadLiveLogs()` replaces with real rows.

```html
        <div class="p-3 bg-surface-container flex items-center gap-3 border-t border-outline-variant">
          <div class="flex-1 flex items-center bg-surface-container-low rounded px-3 py-2 border border-outline-variant">
            <span class="text-primary text-code-sm">query &gt;</span>
            <input class="bg-transparent border-none focus:ring-0 text-on-surface font-code-sm text-code-sm flex-1 ml-2 outline-none" placeholder="service:checkout level:error" id="stream-query"/>
          </div>
          <button class="bg-primary text-on-primary px-4 py-2 rounded text-code-sm font-bold hover:brightness-110 transition-all" onclick="loadLiveLogs()">RUN</button>
        </div>
      </div>
```
Lines 75-82. A styled fake terminal prompt (a literal `query >` label, not an actual shell) feeding a text input `id="stream-query"` whose placeholder demonstrates the mini query syntax (`service:checkout level:error`), plus a "RUN" button that re-invokes `loadLiveLogs()` on click.

```html
      <div class="col-span-4 bg-surface border border-outline-variant rounded flex flex-col h-[480px] overflow-hidden">
        <div class="px-4 py-3 border-b border-outline-variant bg-surface-container-low"><h3 class="text-body-md font-bold text-primary">Cluster Health</h3></div>
        <div class="p-5 flex-1 flex flex-col justify-between space-y-4" id="cluster-health"></div>
      </div>
    </div>
```
Lines 83-87. The right-hand panel (`col-span-4`, "Cluster Health") is just a titled header and an empty content `div` (`id="cluster-health"`) — all of its content is generated entirely by `loadClusterHealth()`.

```html
    <div class="bg-surface border border-error/50 rounded p-4 border-l-4 border-error hidden" id="alert-banner">
      <div class="flex items-center gap-4">
        <div class="p-2.5 bg-error/10 text-error rounded"><span class="material-symbols-outlined">notification_important</span></div>
        <div class="flex-1"><h4 class="text-body-md font-bold text-primary" id="alert-title">No active alerts</h4><p class="text-code-sm text-on-surface-variant mt-0.5" id="alert-desc">System is operating normally.</p></div>
        <a href="/logs-explorer" class="px-4 py-2 bg-primary text-on-primary rounded text-code-sm font-bold hover:opacity-90 transition-all">View Logs</a>
      </div>
    </div>
  </div>
</main>
```
Lines 88-96. An alert banner, initially hidden (`hidden` class on line 88), with placeholder title/description text (`id="alert-title"`/`id="alert-desc"`) and a "View Logs" link. Nothing in this page's inline script (or in `app.js`) ever removes the `hidden` class or updates these two ids — despite the app having a real `alertService`/`alertsRouter` on the backend (see `src/app.ts`), this banner is never wired up here, so it stays permanently hidden as shipped.

```html
<script src="app.js"></script>
<script>
initTheme();
```
Lines 97-99. Loads `app.js`, then the page's own inline script begins by applying the saved/preferred theme, same as the other pages.

```js
async function loadMetrics() {
  const until = new Date().toISOString();
  const since = new Date(Date.now()-3600000).toISOString();
  const since24h = new Date(Date.now()-86400000).toISOString();
```
Lines 100-103. Computes three ISO timestamps: now, one hour ago (`3600000` ms), and 24 hours ago (`86400000` ms) — the time windows used by the metric queries below.

```js
  const [totalRes, errAgg, svcRes, ingestAgg] = await Promise.all([
    fetchJSON('/logs?limit=1'),
    fetchJSON(`/logs/aggregate?since=${since}&until=${until}&bucket=1h&level=error`),
    fetchJSON('/logs?limit=1000'),
    fetchJSON(`/logs/aggregate?since=${since24h}&until=${until}&bucket=1h`)
  ]);
```
Lines 104-109. Four requests fire in parallel via `fetchJSON` (from `app.js`, which returns `null` on any non-2xx response or network error rather than throwing): a 1-row fetch of `/logs` (used only to read its `total` count field, not its single row), an hourly-bucketed error aggregate for the last hour, up to 1000 recent logs (used only to enumerate distinct services, not their content), and an hourly-bucketed all-level aggregate over the last 24 hours.

```js
  document.getElementById('metric-total').textContent = totalRes?.total?.toLocaleString() ?? '—';
```
Line 110. Sets the Total Logs card from `totalRes.total`, formatted with locale thousands separators; falls back to the em dash placeholder if the field is missing or the request failed.

```js
  const errCount = errAgg?.buckets?.reduce((s,b)=>s+b.count,0)||0;
  document.getElementById('metric-error-count').textContent = errCount+'h';
  document.getElementById('metric-errors').textContent = errCount;
```
Lines 111-113. Sums the `count` field across all returned hourly buckets to get the total error count for the past hour, then writes it into both the small badge (suffixed `"h"`, e.g. `"3h"` — labeling it as if it were a rate, even though it's actually a total count over one hour, not a per-hour rate) and the large metric value.

```js
  document.getElementById('metric-services').textContent = [...new Set((svcRes?.logs||[]).map(l=>l.service))].size||'—';
```
Line 114. Builds a `Set` of `service` names from the (up to 1000) fetched log rows and reports its `size` as the "Services" count — an approximation bounded by whatever services appear within the most recent 1000 logs, not a true distinct-count over the whole dataset.

```js
  const rate = ingestAgg?.buckets?.length ? Math.round(ingestAgg.buckets.reduce((s,b)=>s+b.count,0)/24) : 0;
  document.getElementById('metric-ingestion').textContent = rate+'/h';
}
```
Lines 115-117. Sums all 24 hourly bucket counts and divides by 24 to get an average hourly ingestion rate, rounding to the nearest integer, displayed as `"{rate}/h"`. If there are no buckets at all, it falls back to `0` rather than the em dash used elsewhere.

```js
async function loadLiveLogs() {
  const q = document.getElementById('stream-query').value;
  const params = new URLSearchParams({limit:'50'});
```
Lines 118-120. Reads the free-text query box and starts building query parameters for `/logs`, always requesting at most 50 rows.

```js
  if (q) { q.split(' ').forEach(p => { if(p.includes(':')){const[k,v]=p.split(':');if(k==='service')params.set('service',v);if(k==='level')params.set('level',v);} else params.set('q',p); }); }
```
Line 121. Implements a small space-delimited query mini-language client-side: splits the input on spaces, and for each token containing a colon, splits it into a key/value pair — recognizing only `service:` and `level:` as structured filters (any other key silently does nothing) — while any token without a colon is treated as free text and set as the `q` parameter (only the last such token wins, since `params.set` overwrites).

```js
  const res = await fetchJSON('/logs?'+params);
  const container = document.getElementById('log-stream'); container.innerHTML = '';
  const logs = res?.logs || [];
  document.getElementById('stream-count').textContent = logs.length+' logs';
```
Lines 122-125. Fetches the filtered logs, clears the `#log-stream` container (wiping the "Loading..." placeholder or any previous run's rows), and updates the `#stream-count` label with however many rows came back (capped at 50 by the `limit` param, so this is "rows shown," not necessarily "rows matching").

```js
  logs.forEach(log => {
    const d = document.createElement('div');
    d.className = `flex items-start gap-2 py-1 px-2 hover:bg-surface-container-highest/30 border-l-2 ${log.level==='error'?'border-l-error':log.level==='warn'?'border-l-amber-500':'border-l-primary/30'}`;
    d.innerHTML = `<span class="text-on-surface-variant/60 w-24 shrink-0 font-code-sm">${new Date(log.timestamp).toLocaleTimeString()}</span>${levelBadge(log.level)}<span class="text-on-surface flex-1 truncate text-code-sm">${log.service}: ${log.message}</span>`;
    container.appendChild(d);
  });
}
```
Lines 126-132. Renders one row per log: a `<div>` whose left-border color depends on level (red for `error`, amber for `warn`, translucent primary for anything else), containing a locale-formatted time, a colored pill badge from `app.js`'s `levelBadge(log.level)` helper, and the `"{service}: {message}"` text. Row HTML is built with template-literal interpolation directly from server data (no escaping), then appended to the container.

```js
async function loadClusterHealth() {
  const until = new Date().toISOString();
  const since = new Date(Date.now()-3600000).toISOString();
  const agg = await fetchJSON(`/logs/aggregate?since=${since}&until=${until}&bucket=5m&group_by=service`);
  const buckets = agg?.buckets || [];
  const services = [...new Set(buckets.map(b=>b.group))].slice(0,5);
```
Lines 133-138. Fetches a 5-minute-bucketed, per-service aggregate over the last hour, then derives up to 5 distinct service names (`b.group`) from the returned buckets.

```js
  document.getElementById('cluster-health').innerHTML = services.length
    ? `<div class="space-y-3">${services.map(s=>{const total=buckets.filter(b=>b.group===s).reduce((a,b)=>a+b.count,0);const h=total<100?99.9:total<500?95:85;return `<div><div class="flex justify-between mb-1 text-code-sm"><span class="font-bold text-primary">${s.toUpperCase()}</span><span class="${h>=99?'text-secondary':'text-error'}">${h}%</span></div><div class="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden"><div class="h-full ${h>=99?'bg-secondary':'bg-error'}" style="width:${h}%"></div></div></div>`}).join('')}</div><div class="h-28 bg-surface-container-low rounded flex items-center justify-center border border-dashed border-outline-variant/50"><div class="text-center"><p class="text-code-sm text-on-surface-variant">Last 1 hour</p><p class="text-body-md font-bold text-primary mt-0.5">${buckets.reduce((a,b)=>a+b.count,0)} events</p></div></div>`
    : '<div class="text-center text-on-surface-variant text-body-md flex-1 flex items-center justify-center">No service data yet</div>';
}
```
Lines 139-142. For each of the up to 5 services, sums its total event count across the fetched buckets and maps that total to a synthetic "health" percentage via a hardcoded heuristic: under 100 events → 99.9%, under 500 → 95%, otherwise 85%. This is not a real uptime/error-rate signal — it's purely a volume proxy where a *busier* service is scored as *less* healthy, with no reference to error counts or actual health checks. Each service renders as a label, percentage (green if ≥99%, red otherwise), and a matching progress bar; below the per-service list is a total-events tile summing all buckets for "Last 1 hour." If there are no services at all, an empty-state message is shown instead.

```js
loadMetrics(); loadLiveLogs(); loadClusterHealth(); loadNotifications();
setInterval(loadMetrics, 10000);
setInterval(loadLiveLogs, 5000);
setInterval(loadNotifications, 30000);
```
Lines 143-146. Kicks off all four loaders once on page load, then re-polls `loadMetrics` every 10s and `loadLiveLogs` every 5s (each poll re-reads the current `#stream-query` value, so an in-progress filter keeps being re-applied automatically) and `loadNotifications` every 30s. `loadNotifications` (defined in `app.js`) looks up `#notif-badge` and `#notif-list`, and returns immediately if the list container isn't found — this page defines neither element, so on this page every one of these calls is a no-op; the notification bell/panel only exists on pages that include that markup.

```js
const dot = document.getElementById('live-dot');
if(dot) setInterval(() => dot.style.opacity = dot.style.opacity === '0.3' ? '1' : '0.3', 1500);
</script>
</body></html>
```
Lines 147-150. Finds the live-stream indicator dot and, if present, manually toggles its `opacity` between `1` and `0.3` every 1.5 seconds — layered on top of the `animate-pulse` Tailwind class already applied to the same element in the markup (line 71), so the blinking effect on this dot is actually driven by two independent, redundant mechanisms (a CSS keyframe animation and this JS interval) rather than one. This closes the inline script, body, and document.
