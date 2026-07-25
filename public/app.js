/* === Theme System === */
function initTheme() {
  const saved = localStorage.getItem('lumina-theme');
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
  localStorage.setItem('lumina-theme', isDark ? 'dark' : 'light');
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
  error: { bg: 'bg-error/10', text: 'text-error', border: 'border-error/30' },
  warn: { bg: 'bg-orange-400/10', text: 'text-orange-400', border: 'border-orange-400/30' },
  info: { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/30' },
  debug: { bg: 'bg-outline/10', text: 'text-outline', border: 'border-outline/30' },
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
