let confirmCallback = null;

function showConfirm(title, msg, callback) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent = msg;
  confirmCallback = callback;
  const modal = document.getElementById('confirm-modal');
  const content = document.getElementById('confirm-modal-content');
  modal.classList.remove('opacity-0', 'invisible');
  content.classList.remove('scale-95');
}

function closeConfirm() {
  const modal = document.getElementById('confirm-modal');
  const content = document.getElementById('confirm-modal-content');
  modal.classList.add('opacity-0', 'invisible');
  content.classList.add('scale-95');
  confirmCallback = null;
}

function executeConfirm() {
  if(confirmCallback) confirmCallback();
  closeConfirm();
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const colors = {
    success: 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400',
    error: 'bg-rose-500/10 border-rose-500/50 text-rose-400',
    warning: 'bg-amber-500/10 border-amber-500/50 text-amber-400',
    info: 'bg-blue-500/10 border-blue-500/50 text-blue-400'
  };
  
  toast.className = `glass-card border ${colors[type] || colors.info} px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 text-sm transform transition-all duration-300 translate-y-4 opacity-0`;
  toast.innerHTML = `<div class="font-mono text-xs">${message}</div>`;
  container.appendChild(toast);
  
  requestAnimationFrame(() => toast.classList.remove('translate-y-4', 'opacity-0'));
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-x-4');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Ersetzt showQuickMsg optisch durch Toasts, aber behält Kompatibilität
function showQuickMsg(msg, color) {
  let type = 'info';
  if(color.includes('green')) type = 'success';
  if(color.includes('red')) type = 'error';
  if(color.includes('amber')) type = 'warning';
  showToast(msg, type);
}

// ---------- ORIGINAL LOGIC ----------
if (!LootGameAPI.isLoggedIn()) window.location.href = '/login.html';

let activeTab = 'dashboard';
let logFilter = 'ALL';
let categoryFilter = 'ALL';
let allLogs   = [];
let allCDs    = [];
let logPoll   = null;
let serverPw  = null;

// ─── Aktueller User + Permissions ─────────────────────────────────────────────
let currentUser = { username: '', role: 'mod', permissions: [] };

const TAB_PERMISSIONS = {
  analytics: 'analytics:view',
  logs:      'logs:view',
  cooldowns: 'cooldowns:manage',
  players:   'players:view',
  events:    'events:manage',
  squads:    'squads:manage',
  server:    'server:manage',
  users:     'superadmin' // Spezialfall, kein Permission-Key
};

function canAccess(tab) {
  const need = TAB_PERMISSIONS[tab];
  if (!need) return true; // overview ist immer offen
  if (currentUser.role === 'superadmin') return true;
  if (need === 'superadmin') return false;
  return currentUser.permissions.includes(need);
}

async function loadCurrentUser() {
  try {
    const me = await fetch('/api/auth/me', { headers: { 'x-session-token': LootGameAPI.getToken() } }).then(r => r.json());
    currentUser = { username: me.username, role: me.role, permissions: me.permissions || [] };
    const el = document.getElementById('sidebarUsername');
    if (el) el.textContent = currentUser.username;
  } catch (err) {
    console.error('Konnte aktuellen User nicht laden:', err);
  }
}

// ─── Live-Updates (eigener WebSocket-Kanal, NICHT die Twitch-EventSub-Verbindung) ───
function doLogout() {
  showConfirm('Abmelden?', 'Du wirst aus dem Dashboard ausgeloggt.', () => {
    LootGameAPI.logout(); // leitet bereits selbst auf /login.html weiter
  });
}

function toggleMobileMore() {
  const sheet = document.getElementById('mobileMoreSheet');
  if (!sheet) return;
  sheet.classList.toggle('hidden');
  if (!sheet.classList.contains('hidden')) applyPermissionVisibility();
}

function applyPermissionVisibility() {
  document.querySelectorAll('[data-permission]').forEach(el => {
    const need = el.dataset.permission;
    const ok = currentUser.role === 'superadmin' || (need !== 'superadmin' && currentUser.permissions.includes(need));
    el.classList.toggle('hidden', !ok);
  });
}

// ─── Health Ping ──────────────────────────────────────────────────────────────
async function pingHealth() {
  const t0 = Date.now();
  try {
    const d = await fetch('/health').then(r => r.json());
    const ms = Date.now() - t0;
    document.getElementById('pingVal').textContent = ms + 'ms';
    const u = Math.floor(d.uptime);
    const h = Math.floor(u/3600), m = Math.floor((u%3600)/60), s = u%60;
    document.getElementById('uptimeVal').textContent = h + 'h ' + m + 'm ' + s + 's';

    const dot = document.getElementById('botDot');
    const label = document.getElementById('botStatusLabel');
    if (dot) dot.style.background = d.botConnected ? '#10b981' : '#f43f5e';
    if (dot) dot.style.boxShadow = d.botConnected ? '0 0 6px #10b981' : '0 0 6px #f43f5e';
    if (label) label.textContent = d.botConnected ? 'BOT ONLINE' : 'BOT OFFLINE';
  } catch {
    const dot = document.getElementById('botDot');
    const label = document.getElementById('botStatusLabel');
    if (dot) { dot.style.background = '#f43f5e'; dot.style.boxShadow = '0 0 6px #f43f5e'; }
    if (label) label.textContent = 'SERVER OFFLINE';
  }
}
setInterval(pingHealth, 10000);
pingHealth();

// ─── Tabs ─────────────────────────────────────────────────────────────────────
const tabCache = {};

async function loadTabContent(tab) {
  if (tabCache[tab]) return tabCache[tab];
  const res = await fetch('admin-tabs/' + tab + '.html');
  const html = await res.text();
  tabCache[tab] = html;
  return html;
}

const tabTitles = {
  'overview': 'Übersicht',
  'analytics': 'Statistiken',
  'logs': 'Bot Log Terminal',
  'cooldowns': 'Cooldown Management',
  'players': 'Spieler-Verwaltung',
  'events': 'Live Event Control',
  'squads': 'Squad-Verwaltung',
  'users': 'User Management',
  'server': 'Server Diagnostics'
};

async function navigateTo(tab) {
  if (!canAccess(tab)) {
    showToast('Keine Berechtigung für diesen Bereich', 'error');
    if (tab !== 'overview') return navigateTo('overview');
    return;
  }

  const container = document.getElementById('tab-container');
  container.innerHTML = '<div class="flex items-center justify-center h-40 text-slate-500 text-xs font-mono">Lade...</div>';

  try {
    const html = await loadTabContent(tab);
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="text-rose-400 text-xs font-mono p-4">Fehler beim Laden: ' + err.message + '</div>';
    return;
  }

  document.querySelectorAll('[data-nav]').forEach(el => {
    el.classList.toggle('nav-active', el.dataset.nav === tab);
  });

  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = tabTitles[tab] || tab;

  activeTab = tab;
  if (tab !== 'logs' && logPoll) { clearInterval(logPoll); logPoll = null; updateLogStatus(false); }
  if (tab === 'overview')   { loadOverview(); applyPermissionVisibility(); renderLiveFeed(); updateLiveFeedStatusBadge(); }
  if (tab === 'analytics')  loadAnalytics(currentAnDays || 7);
  if (tab === 'logs')       startLogPoll();
  if (tab === 'cooldowns')  loadCooldowns();
  if (tab === 'players')    loadPlayers();
  if (tab === 'events')     loadEvents();
  if (tab === 'squads')     loadSquads();
  if (tab === 'users')      loadUsers();
  if (tab === 'server')     checkServerAccess();
}

// Alias für Abwärtskompatibilität mit altem Code
function showTab(tab) { return navigateTo(tab); }

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function formatVal(v) {
  if (!v) return '0 ₽';
  if (v >= 1e9) return (v/1e9).toFixed(2) + 'B ₽';
  if (v >= 1e6) return (v/1e6).toFixed(2) + 'M ₽';
  if (v >= 1e3) return (v/1e3).toFixed(0) + 'K ₽';
  return v + ' ₽';
}
async function apiCall(url, method = 'GET', body = undefined) {
  const opts = { method, headers:{'Content-Type':'application/json','x-session-token':LootGameAPI.getToken()} };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  return res.json();
}

function updateDashTournamentBtn(active) {
  const btn = document.getElementById('dashTournamentBtn');
  if (!btn) return;
  btn.dataset.active = active;
  if (active) {
    btn.textContent = '🏆 Turnier: AN';
    btn.className = 'px-3 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 text-xs font-mono tracking-wide transition-colors';
  } else {
    btn.textContent = '🏆 Turnier: AUS';
    btn.className = 'px-3 py-2.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 text-xs font-mono tracking-wide transition-colors';
  }
}