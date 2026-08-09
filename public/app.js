/* === Theme System === */
function initTheme() {
  const saved = localStorage.getItem('obsidian-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.classList.toggle('light', theme === 'light');
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
}

function toggleTheme() {
  const html = document.documentElement;
  html.classList.toggle('dark');
  html.classList.toggle('light');
  const isDark = html.classList.contains('dark');
  localStorage.setItem('obsidian-theme', isDark ? 'dark' : 'light');
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = isDark ? 'light_mode' : 'dark_mode';
}

/* === API Utilities === */
async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/* === CSV Export === */
function downloadCSV(filename, headers, rows) {
  const escapeCell = (val) => {
    const str = String(val ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [headers, ...rows].map(row => row.map(escapeCell).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* === Time Helpers === */
function ago(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function formatTime(iso) {
  return new Date(iso).toLocaleString();
}

function formatTimeShort(iso) {
  return new Date(iso).toLocaleTimeString();
}

/* === Level Helpers === */
const LEVEL_COLORS = {
  error: { bg: 'bg-error/15', text: 'text-error', border: 'border-error/30' },
  warn: { bg: 'bg-amber-400/15', text: 'text-amber-400', border: 'border-amber-400/30' },
  info: { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/20' },
  debug: { bg: 'bg-outline/10', text: 'text-outline', border: 'border-outline/20' },
  success: { bg: 'bg-secondary/15', text: 'text-secondary', border: 'border-secondary/30' },
};

function levelBadge(lvl) {
  const c = LEVEL_COLORS[lvl] || LEVEL_COLORS.info;
  return `<span class="px-2 py-0.5 ${c.bg} ${c.text} ${c.border} border rounded-full text-[10px] font-bold uppercase">${lvl}</span>`;
}

function levelRowClass(lvl) {
  return `log-row-${lvl}`;
}

/* === Log Stream Renderer === */
function renderLogRow(log) {
  return `<div class="flex items-start gap-3 py-1 px-2 hover:bg-surface-container-highest/20 border-l-4 ${levelRowClass(log.level)}">
    <span class="text-on-surface-variant/60 w-28 shrink-0 font-mono text-xs">${formatTimeShort(log.timestamp)}</span>
    ${levelBadge(log.level)}
    <span class="text-on-surface flex-1 truncate text-xs">${log.service}: ${log.message}</span>
  </div>`;
}

/* === Signed-in User Identity === */
async function loadUserIdentity() {
  const data = await fetchJSON('/auth/session');
  const avatarEl = document.getElementById('user-identity-avatar');
  const nameEl = document.getElementById('user-identity-name');
  const subEl = document.getElementById('user-identity-sub');
  if (!data?.authenticated) return;
  if (avatarEl) avatarEl.textContent = data.username.charAt(0).toUpperCase();
  if (nameEl) nameEl.textContent = data.username;
  if (subEl) subEl.textContent = `user #${data.id}`;
}

/* === Logout === */
async function logout() {
  try {
    await fetch('/auth/logout', { method: 'POST' });
  } catch (e) {
    // continue even if request fails
  }
  window.location.href = '/login.html';
}

/* === Drawer === */
function openDrawer(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('translate-x-full');
}

function closeDrawer(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('translate-x-full');
}

/* === Notifications === */
async function loadNotifications() {
  const data = await fetchJSON('/notifications');
  const list = data?.notifications || [];
  const badge = document.getElementById('notif-badge');
  const container = document.getElementById('notif-list');
  if (!container) return;
  const unread = list.filter(n => !n.is_read);
  if (badge) {
    badge.classList.toggle('hidden', unread.length === 0);
  }
  if (!list.length) {
    container.innerHTML = '<div class="px-4 py-8 text-center text-on-surface-variant text-sm">No notifications</div>';
    return;
  }
  container.innerHTML = list.map(n => {
    const icons = { alert: 'notification_important', retention: 'storage', system: 'info' };
    const icon = icons[n.type] || 'circle';
    const time = new Date(n.created_at).toLocaleString();
    return `<div class="px-4 py-3 border-b border-outline-variant/10 hover:bg-surface-container-highest/30 ${n.is_read ? 'opacity-60' : ''}">
      <div class="flex items-start gap-3">
        <span class="material-symbols-outlined text-sm mt-0.5 ${n.type === 'alert' ? 'text-error' : n.type === 'retention' ? 'text-tertiary' : 'text-primary'}">${icon}</span>
        <div class="flex-1 min-w-0">
          <div class="flex justify-between items-start gap-2">
            <p class="text-sm font-medium truncate">${n.title}</p>
            ${n.is_read ? '' : '<span class="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5"></span>'}
          </div>
          <p class="text-xs text-on-surface-variant mt-0.5 truncate">${n.message}</p>
          <p class="text-[10px] text-on-surface-variant/60 mt-1">${time}</p>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleNotif() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) loadNotifications();
}

document.addEventListener('click', function (e) {
  const panel = document.getElementById('notif-panel');
  const btn = document.getElementById('notif-btn');
  if (panel && btn && !panel.contains(e.target) && !btn.contains(e.target)) {
    panel.classList.add('hidden');
  }
});



async function markAllNotifRead() {
  await fetch('/notifications/read-all', { method: 'POST' });
  loadNotifications();
  const badge = document.getElementById('notif-badge');
  if (badge) badge.classList.add('hidden');
}

/* === Dynamic Shared UI Components (Docs, Support, Toast Alerts) === */
(function () {
  // Initialize theme on load
  if (typeof initTheme === 'function') initTheme();

  // Populate the signed-in user's identity in the sidebar
  loadUserIdentity();

  // Inject Shared CSS styles
  const css = `
    /* Toast System */
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 9999;
      pointer-events: none;
    }
    .toast {
      min-width: 300px;
      max-width: 450px;
      padding: 14px 18px;
      border-radius: 6px;
      background: rgba(23, 31, 51, 0.9);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #dae2fd;
      font-size: 13px;
      font-family: 'Geist', sans-serif;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
      display: flex;
      align-items: center;
      gap: 12px;
      transform: translateY(20px);
      opacity: 0;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: auto;
    }
    .toast.show {
      transform: translateY(0);
      opacity: 1;
    }
    .toast-success { border-left: 4px solid #4edea3; }
    .toast-error { border-left: 4px solid #ffb4ab; }
    .toast-info { border-left: 4px solid #60a5fa; }
    
    /* Global Drawer Elements */
    .drawer-overlay {
      position: fixed;
      inset: 0;
      background-color: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      z-index: 1000;
      opacity: 0;
      transition: opacity 0.3s ease;
      pointer-events: none;
    }
    .drawer-overlay.active {
      opacity: 1;
      pointer-events: auto;
    }
    .custom-drawer {
      position: fixed;
      top: 0;
      right: 0;
      height: 100%;
      width: 500px;
      background-color: #171f33; /* surface-container */
      border-left: 1px solid #44474a; /* outline-variant */
      z-index: 1001;
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
      box-shadow: -10px 0 40px rgba(0,0,0,0.5);
    }
    .custom-drawer.active {
      transform: translateX(0);
    }
    .drawer-header {
      padding: 16px 20px;
      border-b: 1px solid rgba(68, 71, 74, 0.5);
      background-color: #131b2e; /* surface-container-low */
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .drawer-body {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      background-color: #0b1326; /* background */
    }
    
    /* Support Chat Specifics */
    .chat-container {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 12px;
    }
    .chat-bubble {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.5;
      font-family: 'Geist', sans-serif;
    }
    .bubble-bot {
      background: #171f33;
      color: #dae2fd;
      align-self: flex-start;
      border-bottom-left-radius: 2px;
      border: 1px solid rgba(255,255,255,0.05);
    }
    .bubble-user {
      background: #ffffff;
      color: #171f33;
      align-self: flex-end;
      border-bottom-right-radius: 2px;
    }
    .chat-input-wrapper {
      padding: 12px;
      border-top: 1px solid #44474a;
      background: #131b2e;
      display: flex;
      gap: 8px;
    }
    .chat-input {
      flex: 1;
      background: #060e20;
      border: 1px solid #44474a;
      color: #ffffff;
      border-radius: 4px;
      padding: 8px 12px;
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s;
    }
    .chat-input:focus {
      border-color: #4edea3;
    }
    
    /* Docs Search and Content */
    .docs-search {
      width: 100%;
      background: #131b2e;
      border: 1px solid #44474a;
      color: #ffffff;
      border-radius: 6px;
      padding: 10px 14px 10px 40px;
      font-size: 13px;
      outline: none;
      margin-bottom: 20px;
      transition: border-color 0.2s;
    }
    .docs-search:focus {
      border-color: #4edea3;
    }
    .doc-section {
      background: #171f33;
      border: 1px solid rgba(68, 71, 74, 0.4);
      border-radius: 6px;
      margin-bottom: 12px;
      overflow: hidden;
    }
    .doc-section-header {
      padding: 12px 16px;
      font-weight: 600;
      color: #ffffff;
      background: rgba(19, 27, 46, 0.4);
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
    }
    .doc-section-header:hover {
      background: rgba(19, 27, 46, 0.8);
    }
    .doc-section-content {
      padding: 16px;
      border-t: 1px solid rgba(68, 71, 74, 0.2);
      font-size: 13px;
      line-height: 1.6;
      color: #c5c6cb;
      display: block;
    }
    .doc-section-content.hidden {
      display: none;
    }
    .doc-code-block {
      background: #060e20;
      padding: 12px;
      border-radius: 4px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #4edea3;
      overflow-x: auto;
      margin: 8px 0;
      border: 1px solid rgba(255,255,255,0.03);
    }

    /* Add Log Modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background-color: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .modal-overlay.active {
      opacity: 1;
      pointer-events: auto;
    }
    .modal-box {
      background: #171f33;
      border: 1px solid #44474a;
      border-radius: 8px;
      width: 440px;
      max-width: 90vw;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      transform: translateY(10px);
      opacity: 0;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .modal-overlay.active .modal-box {
      transform: translateY(0);
      opacity: 1;
    }
    .modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid rgba(68, 71, 74, 0.5);
      background-color: #131b2e;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .modal-body {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .modal-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: #8e9195;
      font-weight: 600;
    }
    .modal-input {
      width: 100%;
      background: #060e20;
      border: 1px solid #44474a;
      color: #ffffff;
      border-radius: 4px;
      padding: 8px 12px;
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s;
      font-family: 'JetBrains Mono', monospace;
    }
    .modal-input:focus {
      border-color: #4edea3;
    }
    textarea.modal-input {
      resize: vertical;
      min-height: 60px;
    }
    .modal-error {
      color: #ffb4ab;
      font-size: 12px;
    }
    .modal-footer {
      padding: 16px 20px;
      border-top: 1px solid rgba(68, 71, 74, 0.5);
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // Initialize Global Toast Container
  let toastContainer = document.querySelector('.toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  // Toast Function
  window.showToast = function (message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
      success: 'check_circle',
      error: 'error',
      info: 'info'
    };
    const icon = icons[type] || 'info';
    const colors = {
      success: 'text-secondary',
      error: 'text-error',
      info: 'text-blue-400'
    };

    toast.innerHTML = `
      <span class="material-symbols-outlined ${colors[type] || ''}">${icon}</span>
      <span style="flex-1">${message}</span>
    `;

    toastContainer.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 50);

    // Dismiss automatically
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  };

  // Add Log Modal
  const addLogOverlay = document.createElement('div');
  addLogOverlay.className = 'modal-overlay';
  addLogOverlay.id = 'add-log-overlay';
  addLogOverlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-secondary">post_add</span>
          <h2 class="text-primary font-bold text-base font-headline-md">Add Log</h2>
        </div>
        <button class="text-on-surface-variant hover:text-primary transition-colors" id="add-log-close">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="modal-body">
        <div>
          <p class="modal-label mb-1">Level</p>
          <select id="add-log-level" class="modal-input">
            <option value="debug">debug</option>
            <option value="info" selected>info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
        </div>
        <div>
          <p class="modal-label mb-1">Service</p>
          <input id="add-log-service" class="modal-input" placeholder="checkout" type="text" />
        </div>
        <div>
          <p class="modal-label mb-1">Message</p>
          <input id="add-log-message" class="modal-input" placeholder="payment declined" type="text" />
        </div>
        <div>
          <p class="modal-label mb-1">Attributes (JSON, optional)</p>
          <textarea id="add-log-attrs" class="modal-input" placeholder='{"user_id": "42", "region": "eu-west"}'></textarea>
        </div>
        <p id="add-log-error" class="modal-error hidden"></p>
      </div>
      <div class="modal-footer">
        <button id="add-log-cancel" class="px-4 py-1.5 border border-outline-variant text-on-surface-variant font-body-md text-body-md hover:text-primary transition-all rounded">Cancel</button>
        <button id="add-log-submit" class="px-4 py-1.5 bg-primary text-on-primary font-bold rounded text-body-md hover:opacity-80 active:scale-95 transition-all">Send Log</button>
      </div>
    </div>
  `;
  document.body.appendChild(addLogOverlay);

  function openAddLogModal() {
    document.getElementById('add-log-error').classList.add('hidden');
    addLogOverlay.classList.add('active');
    document.getElementById('add-log-service').focus();
  }

  function closeAddLogModal() {
    addLogOverlay.classList.remove('active');
  }

  document.getElementById('add-log-close').addEventListener('click', closeAddLogModal);
  document.getElementById('add-log-cancel').addEventListener('click', closeAddLogModal);
  addLogOverlay.addEventListener('click', (e) => {
    if (e.target === addLogOverlay) closeAddLogModal();
  });

  document.getElementById('add-log-submit').addEventListener('click', async () => {
    const level = document.getElementById('add-log-level').value;
    const service = document.getElementById('add-log-service').value.trim();
    const message = document.getElementById('add-log-message').value.trim();
    const attrsRaw = document.getElementById('add-log-attrs').value.trim();
    const errorEl = document.getElementById('add-log-error');
    errorEl.classList.add('hidden');

    if (!service || !message) {
      errorEl.textContent = 'Service and message are required.';
      errorEl.classList.remove('hidden');
      return;
    }

    let attributes;
    if (attrsRaw) {
      try {
        attributes = JSON.parse(attrsRaw);
      } catch {
        errorEl.textContent = 'Attributes must be valid JSON.';
        errorEl.classList.remove('hidden');
        return;
      }
    }

    const entry = { timestamp: new Date().toISOString(), level, service, message };
    if (attributes) entry.attributes = attributes;

    try {
      const res = await fetch('/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: [entry] }),
      });
      const data = await res.json();
      if (data.accepted > 0) {
        window.showToast?.('Log added', 'success');
        closeAddLogModal();
        document.getElementById('add-log-service').value = '';
        document.getElementById('add-log-message').value = '';
        document.getElementById('add-log-attrs').value = '';
        if (typeof window.refreshLogsExplorer === 'function') window.refreshLogsExplorer();
      } else {
        errorEl.textContent = data.rejected?.[0]?.reason || 'Log was rejected.';
        errorEl.classList.remove('hidden');
      }
    } catch {
      errorEl.textContent = 'Failed to reach the server.';
      errorEl.classList.remove('hidden');
    }
  });

  // Setup Drawers Markup dynamically
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-overlay';
  document.body.appendChild(backdrop);

  // Docs Drawer Markup
  const docsDrawer = document.createElement('div');
  docsDrawer.className = 'custom-drawer';
  docsDrawer.id = 'shared-docs-drawer';
  docsDrawer.innerHTML = `
    <div class="drawer-header">
      <div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-secondary">menu_book</span>
        <h2 class="text-primary font-bold text-base font-headline-md">Documentation</h2>
      </div>
      <button class="text-on-surface-variant hover:text-primary transition-colors close-drawer-btn">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
    <div class="drawer-body">
      <div style="position: relative;">
        <span class="material-symbols-outlined" style="position: absolute; left: 14px; top: 12px; opacity: 0.5;">search</span>
        <input type="text" class="docs-search" id="docs-search-input" placeholder="Search docs (e.g. query, ingestion)...">
      </div>
      <div class="docs-list" id="docs-accordion">
        
        <div class="doc-section">
          <div class="doc-section-header">
            <span>Getting Started & Architecture</span>
            <span class="material-symbols-outlined text-sm">expand_more</span>
          </div>
          <div class="doc-section-content">
            <p><strong>Log Service</strong> is a hyper-fast log analysis dashboard. It uses TimescaleDB partitioned hypertables behind the scenes to perform real-time ingestion and sub-100ms analytics.</p>
            <p class="mt-2">Logs are automatically aggregated and expired based on retention rules. Uptime status is tracked dynamically across your server nodes.</p>
          </div>
        </div>

        <div class="doc-section">
          <div class="doc-section-header">
            <span>Log Ingestion API (POST /logs)</span>
            <span class="material-symbols-outlined text-sm">expand_more</span>
          </div>
          <div class="doc-section-content">
            <p>Send batches of logs. Invalid logs in a batch won't drop valid ones.</p>
            <pre class="doc-code-block">POST /logs
Content-Type: application/json

{
  "logs": [
    {
      "timestamp": "2026-07-20T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "database error",
      "attributes": { "user_id": "42" }
    }
  ]
}</pre>
          </div>
        </div>

        <div class="doc-section">
          <div class="doc-section-header">
            <span>Log Query API (GET /logs)</span>
            <span class="material-symbols-outlined text-sm">expand_more</span>
          </div>
          <div class="doc-section-content">
            <p>Query logs using parameters. Results are returned sorted by time descending.</p>
            <pre class="doc-code-block">GET /logs?service=checkout&level=error&limit=50</pre>
            <p class="mt-2"><strong>Available parameters:</strong></p>
            <ul class="list-disc pl-4 mt-1 space-y-1">
              <li><code>service</code>: filter by service identifier</li>
              <li><code>level</code>: error, warn, info, or debug</li>
              <li><code>q</code>: message substring search</li>
              <li><code>attr.key</code>: attribute match (e.g. <code>attr.user_id=42</code>)</li>
            </ul>
          </div>
        </div>

        <div class="doc-section">
          <div class="doc-section-header">
            <span>ObsidianQL Search Syntax</span>
            <span class="material-symbols-outlined text-sm">expand_more</span>
          </div>
          <div class="doc-section-content">
            <p>You can search in the search bar of the Logs Explorer using selectors:</p>
            <ul class="list-disc pl-4 mt-2 space-y-1">
              <li><code>status:500</code> - Search messages matching status</li>
              <li><code>level:error</code> - Filter logs of error level</li>
              <li><code>service:auth-service</code> - Select specific service logs</li>
              <li>Type plain text words for substring matching.</li>
            </ul>
          </div>
        </div>

        <div class="doc-section">
          <div class="doc-section-header">
            <span>Retention Policy Rules</span>
            <span class="material-symbols-outlined text-sm">expand_more</span>
          </div>
          <div class="doc-section-content">
            <p>The Retention script runs on startup and every hour thereafter. It automatically crops files and tables to clean up logs older than your specified environment limits (default is 30 days, configurable via <code>RETENTION_DAYS</code>).</p>
            <p class="mt-2">You can trigger a manual cleanup on the Retention settings screen using the **Run Retention** trigger button.</p>
          </div>
        </div>

      </div>
    </div>
  `;
  document.body.appendChild(docsDrawer);

  // Support Drawer Markup
  const supportDrawer = document.createElement('div');
  supportDrawer.className = 'custom-drawer';
  supportDrawer.id = 'shared-support-drawer';
  supportDrawer.innerHTML = `
    <div class="drawer-header">
      <div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-secondary">support_agent</span>
        <div>
          <h2 class="text-primary font-bold text-base font-headline-md">AI Support Desk</h2>
          <div class="flex items-center gap-1.5 mt-0.5">
            <span class="w-1.5 h-1.5 bg-secondary rounded-full animate-pulse"></span>
            <span style="font-size: 10px; color: #4edea3; font-weight: bold;">Agent Online</span>
          </div>
        </div>
      </div>
      <button class="text-on-surface-variant hover:text-primary transition-colors close-drawer-btn">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
    <div class="drawer-body flex flex-col justify-between" style="padding: 12px 16px;">
      <div class="chat-container">
        <div class="chat-messages" id="support-chat-messages">
          <div class="chat-bubble bubble-bot">
            Hello! I am your Log Service AI Assistant. How can I help you with your cluster configuration, queries, or retention policies today?
          </div>
        </div>
        <div class="chat-input-wrapper">
          <input type="text" class="chat-input" id="support-chat-input" placeholder="Ask a support question...">
          <button id="send-chat-btn" class="bg-secondary text-on-secondary font-bold px-4 py-1.5 rounded text-xs hover:brightness-110 active:scale-95 transition-all">Send</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(supportDrawer);

  // Close Drawers logic
  function closeAllDrawers() {
    backdrop.classList.remove('active');
    docsDrawer.classList.remove('active');
    supportDrawer.classList.remove('active');
  }
  backdrop.addEventListener('click', closeAllDrawers);
  document.querySelectorAll('.close-drawer-btn').forEach(btn => {
    btn.addEventListener('click', closeAllDrawers);
  });

  // Open Docs Drawer function
  function openDocsDrawer() {
    closeAllDrawers();
    backdrop.classList.add('active');
    docsDrawer.classList.add('active');
    document.getElementById('docs-search-input').focus();
  }

  // Open Support Drawer function
  function openSupportDrawer() {
    closeAllDrawers();
    backdrop.classList.add('active');
    supportDrawer.classList.add('active');
    document.getElementById('support-chat-input').focus();
  }

  // Docs Search functionality
  const docSearch = document.getElementById('docs-search-input');
  docSearch.addEventListener('input', function () {
    const q = this.value.toLowerCase().trim();
    const sections = document.querySelectorAll('#docs-accordion .doc-section');
    sections.forEach(sec => {
      const headerText = sec.querySelector('.doc-section-header').textContent.toLowerCase();
      const contentText = sec.querySelector('.doc-section-content').textContent.toLowerCase();
      if (!q || headerText.includes(q) || contentText.includes(q)) {
        sec.style.display = 'block';
        if (q) {
          // auto expand matched items
          sec.querySelector('.doc-section-content').classList.remove('hidden');
          sec.querySelector('.material-symbols-outlined').textContent = 'expand_less';
        }
      } else {
        sec.style.display = 'none';
      }
    });
  });

  // Docs Accordion toggling
  document.querySelectorAll('#docs-accordion .doc-section-header').forEach(hdr => {
    hdr.addEventListener('click', function () {
      const content = this.nextElementSibling;
      const icon = this.querySelector('.material-symbols-outlined');
      const isHidden = content.classList.contains('hidden');
      if (isHidden) {
        content.classList.remove('hidden');
        icon.textContent = 'expand_less';
      } else {
        content.classList.add('hidden');
        icon.textContent = 'expand_more';
      }
    });
    // Start collapsed by default
    hdr.nextElementSibling.classList.add('hidden');
  });

  // Support Chat responses
  const chatMessages = document.getElementById('support-chat-messages');
  const chatInput = document.getElementById('support-chat-input');

  function appendChatBubble(text, isUser = false) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isUser ? 'bubble-user' : 'bubble-bot'}`;
    bubble.textContent = text;
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function handleSupportSend() {
    const val = chatInput.value.trim();
    if (!val) return;
    appendChatBubble(val, true);
    chatInput.value = '';

    const typing = document.createElement('div');
    typing.className = 'chat-bubble bubble-bot italic opacity-50';
    typing.id = 'chat-typing-status';
    typing.textContent = 'Support Agent is typing...';
    chatMessages.appendChild(typing);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    fetch('/support/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: val }),
      signal: controller.signal,
    })
      .then(async r => {
        if (!r.ok) throw new Error('support agent unavailable');
        return r.json();
      })
      .then(data => {
        typing.remove();
        appendChatBubble(data.reply || "Sorry, I couldn't process that.", false);
      })
      .catch(() => {
        typing.remove();
        appendChatBubble("Support agent is currently unavailable. Please try again later.", false);
      })
      .finally(() => clearTimeout(timeout));
  }

  document.getElementById('send-chat-btn').addEventListener('click', handleSupportSend);
  chatInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') handleSupportSend();
  });

  // Bind Sidebar items on document load
  function bindSidebar() {
    // Find all sidebar links
    const sidebarAnchors = document.querySelectorAll('aside a, aside button');
    sidebarAnchors.forEach(el => {
      const text = el.textContent.trim();
      const hasDocs = text.includes('Docs') || el.querySelector('[data-icon="menu_book"]') || el.querySelector('.material-symbols-outlined')?.textContent.includes('menu_book');
      const hasSupport = text.includes('Support') || el.querySelector('[data-icon="support_agent"]') || el.querySelector('.material-symbols-outlined')?.textContent.includes('support_agent');

      if (hasDocs) {
        el.removeAttribute('href');
        el.style.cursor = 'pointer';
        el.addEventListener('click', (e) => {
          e.preventDefault();
          openDocsDrawer();
        });
      }

      if (hasSupport) {
        el.removeAttribute('href');
        el.style.cursor = 'pointer';
        el.addEventListener('click', (e) => {
          e.preventDefault();
          openSupportDrawer();
        });
      }
    });

    // Bind Add Log button
    document.getElementById('add-log-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      openAddLogModal();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindSidebar);
  } else {
    bindSidebar();
  }
})();

