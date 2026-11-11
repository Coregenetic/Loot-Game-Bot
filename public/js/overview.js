// Pill-Helfer (Hub-Design)
function setPill(el, text, cls) { if (el) { el.textContent = text; el.className = 'pill ' + cls; } }
function setBar(id, pct) { const el = document.getElementById(id); if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%'; }
function setTxt(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }

// Kennzahlen oben (Bot / Uptime / Ping): kommen aus dem 10-s-Health-Ping in core.js
function renderOverviewKpis() {
  const h = window.lastHealth;
  if (!document.getElementById('kpi-bot-v') || !h) return;
  if (!h.ok) {
    setTxt('kpi-bot-v', 'Offline'); setTxt('kpi-bot-n', 'Server nicht erreichbar');
    setTxt('kpi-up-v', '—'); setTxt('kpi-ping-v', '—'); setTxt('kpi-ping-n', '');
    return;
  }
  setTxt('kpi-bot-v', h.botConnected ? 'Online' : 'Offline');
  setTxt('kpi-bot-n', h.botConnected ? 'Twitch-Chat verbunden' : 'Bot nicht mit Twitch verbunden');
  setTxt('kpi-up-v', fmtUptime(h.uptime));
  setTxt('kpi-ping-v', h.ms + ' ms');
  setTxt('kpi-ping-n', h.ms < 150 ? 'Verbindung schnell' : h.ms < 400 ? 'Verbindung okay' : 'Verbindung langsam');
}

async function loadOverview() {
  renderOverviewKpis();
  const hdr = { headers: { 'x-session-token': LootGameAPI.getToken() } };

  try {
    const maint = await fetch('/api/admin/maintenance', hdr).then(r => r.json());
    setPill(document.getElementById('ov-maintenance-pill'), maint.active ? 'Aktiv' : 'Inaktiv', maint.active ? 'gold' : 'green');
  } catch {}

  try {
    const tour = await fetch('/api/admin/tournament', hdr).then(r => r.json());
    setPill(document.getElementById('ov-tournament-pill'), tour.active ? 'Aktiv' : 'Inaktiv', tour.active ? 'blue' : 'green');
    updateDashTournamentBtn(tour.active);
  } catch {}

  try {
    const [status, metrics] = await Promise.all([
      fetch('/api/admin/hetzner/status', hdr).then(r => r.json()),
      fetch('/api/admin/hetzner/metrics', hdr).then(r => r.json())
    ]);

    const running = status.status === 'running';
    setPill(document.getElementById('ov-hetzner-status'), running ? 'Online' : (status.status || '—'), running ? 'green' : 'pink');
    setTxt('kpi-srv-v', running ? 'Online' : (status.status || '—'));

    if (metrics.cpu !== null && metrics.cpu !== undefined) {
      setTxt('ov-cpu-label', metrics.cpu.toFixed(1) + ' %');
      setBar('ov-cpu-bar', metrics.cpu);
      setTxt('kpi-srv-n', 'CPU ' + metrics.cpu.toFixed(1) + ' %');
    }
    if (metrics.ram) {
      const used = parseFloat((metrics.ram.totalGb - metrics.ram.freeGb).toFixed(1));
      setTxt('ov-ram-label', used + ' / ' + metrics.ram.totalGb + ' GB');
      setBar('ov-ram-bar', (used / metrics.ram.totalGb) * 100);
    }
    if (metrics.disk?.totalGb) {
      const used = parseFloat((metrics.disk.totalGb - metrics.disk.freeGb).toFixed(1));
      setTxt('ov-disk-label', used + ' / ' + metrics.disk.totalGb + ' GB');
      setBar('ov-disk-bar', (used / metrics.disk.totalGb) * 100);
    }
  } catch {}
}

// ─── Quick Actions ────────────────────────────────────────────────────────────
async function clearAllCooldowns() {
  showConfirm('Alle Cooldowns löschen?', 'Möchtest du wirklich alle aktiven Spieler-Cooldowns zurücksetzen?', async () => {
    try {
      await fetch('/api/admin/cooldowns', { method:'DELETE', headers:{'x-session-token':LootGameAPI.getToken()} });
      showQuickMsg('✓ Alle Cooldowns gelöscht', 'var(--green)');
      loadOverview();
      if (activeTab === 'cooldowns') loadCooldowns();
    } catch (e) { showQuickMsg('✗ ' + e.message, 'var(--red)'); }
  });
}
