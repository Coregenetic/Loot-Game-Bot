let confirmCallback = null;

function showConfirm(title, msg, callback) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent = msg;
  confirmCallback = callback;
  document.getElementById('confirm-modal').classList.add('open');
}

function closeConfirm() {
  document.getElementById('confirm-modal').classList.remove('open');
  confirmCallback = null;
}

function executeConfirm() {
  if(confirmCallback) confirmCallback();
  closeConfirm();
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'adm-toast ' + (['success','error','warning','info'].includes(type) ? type : 'info');
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
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
  server:     'server:manage',
  monitoring: 'server:manage',
  users:      'superadmin' // Spezialfall, kein Permission-Key
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
    // Eingeschränkte Session (Passwort-Login bei aktiver Passkey-Pflicht): nur die Einrichtung ist erlaubt
    if (me.limited) { window.location.href = '/passkey-setup.html'; return; }
    currentUser = { username: me.username, role: me.role, permissions: me.permissions || [] };
    const el = document.getElementById('sidebarUsername');
    if (el) el.textContent = currentUser.username;
    const av = document.getElementById('sidebarAvatar');
    if (av) av.textContent = (currentUser.username || '?').charAt(0).toUpperCase();
    const rl = document.getElementById('sidebarRole');
    if (rl) rl.textContent = { superadmin: 'Superadmin', admin: 'Admin', mod: 'Moderator' }[currentUser.role] || currentUser.role;
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
  // Gruppenüberschriften ausblenden, wenn kein Eintrag darunter sichtbar ist
  document.querySelectorAll('.adm-grp').forEach(g => {
    let n = g.nextElementSibling, any = false;
    while (n && !n.classList.contains('adm-grp')) { if (!n.classList.contains('hidden')) any = true; n = n.nextElementSibling; }
    g.classList.toggle('hidden', !any);
  });
}

// ─── Health Ping ──────────────────────────────────────────────────────────────
function fmtUptime(sec) {
  const u = Math.floor(sec);
  const d = Math.floor(u / 86400), h = Math.floor((u % 86400) / 3600), m = Math.floor((u % 3600) / 60);
  return d > 0 ? d + 'd ' + h + 'h' : h > 0 ? h + 'h ' + m + 'm' : m + 'm ' + (u % 60) + 's';
}

function setBotChip(state, text) {
  const chip = document.getElementById('botChip');
  const label = document.getElementById('botStatusLabel');
  if (chip) chip.className = 'chip ' + state;
  if (label) label.textContent = text;
}

window.lastHealth = null;
async function pingHealth() {
  const t0 = Date.now();
  try {
    const d = await fetch('/health').then(r => r.json());
    const ms = Date.now() - t0;
    document.getElementById('pingVal').textContent = ms + ' ms';
    document.getElementById('uptimeVal').textContent = fmtUptime(d.uptime);
    setBotChip(d.botConnected ? 'ok' : 'bad', d.botConnected ? 'BOT ONLINE' : 'BOT OFFLINE');
    window.lastHealth = { ok: true, ms, uptime: d.uptime, botConnected: !!d.botConnected };
  } catch {
    setBotChip('bad', 'SERVER OFFLINE');
    window.lastHealth = { ok: false };
  }
  if (typeof renderOverviewKpis === 'function') renderOverviewKpis();
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
  'logs': 'Bot Log',
  'cooldowns': 'Cooldowns',
  'players': 'Spieler',
  'events': 'Live Events',
  'squads': 'Squads',
  'users': 'User',
  'server': 'Server',
  'monitoring': 'Monitoring'
};

async function navigateTo(tab) {
  if (!canAccess(tab)) {
    showToast('Keine Berechtigung für diesen Bereich', 'error');
    if (tab !== 'overview') return navigateTo('overview');
    return;
  }

  const container = document.getElementById('tab-container');
  container.innerHTML = '<div class="tab-loading">Lade…</div>';

  try {
    const html = await loadTabContent(tab);
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="tab-loading" style="color:var(--pink)">Fehler beim Laden: ' + escHtml(err.message) + '</div>';
    return;
  }

  document.querySelectorAll('[data-nav]').forEach(el => {
    el.classList.toggle('nav-active', el.dataset.nav === tab);
  });

  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = tabTitles[tab] || tab;

  activeTab = tab;
  if (tab !== 'logs' && logPoll) { clearInterval(logPoll); logPoll = null; updateLogStatus(false); }
  if (tab !== 'server' && typeof stopHetznerLive === 'function') stopHetznerLive();
  if (tab !== 'monitoring' && typeof stopMonitoringLive === 'function') stopMonitoringLive();
  if (tab === 'overview')   { loadOverview(); applyPermissionVisibility(); renderLiveFeed(); updateLiveFeedStatusBadge(); }
  if (tab === 'analytics')  loadAnalytics(currentAnDays || 7);
  if (tab === 'logs')       startLogPoll();
  if (tab === 'cooldowns')  loadCooldowns();
  if (tab === 'players')    loadPlayers();
  if (tab === 'events')     loadEvents();
  if (tab === 'squads')     loadSquads();
  if (tab === 'users')      loadUsers();
  if (tab === 'server')     checkServerAccess();
  if (tab === 'monitoring')  startMonitoringLive();
}

// Alias für Abwärtskompatibilität mit altem Code
function showTab(tab) { return navigateTo(tab); }

function escHtml(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

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