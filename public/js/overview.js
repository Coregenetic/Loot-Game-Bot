async function loadOverview() {
  try {
    const maint = await fetch('/api/admin/maintenance', { headers: { 'x-session-token': LootGameAPI.getToken() } }).then(r => r.json());
    const pill = document.getElementById('ov-maintenance-pill');
    if (pill) {
      pill.textContent = maint.active ? 'Aktiv' : 'Inaktiv';
      pill.className = maint.active
        ? 'text-[10px] font-mono px-2.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20'
        : 'text-[10px] font-mono px-2.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
    }
  } catch {}

  try {
    const tour = await fetch('/api/admin/tournament', { headers: { 'x-session-token': LootGameAPI.getToken() } }).then(r => r.json());
    const pill = document.getElementById('ov-tournament-pill');
    if (pill) {
      pill.textContent = tour.active ? 'Aktiv' : 'Inaktiv';
      pill.className = tour.active
        ? 'text-[10px] font-mono px-2.5 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20'
        : 'text-[10px] font-mono px-2.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
    }
    updateDashTournamentBtn(tour.active);
  } catch {}

  try {
    const info = await fetch('/api/admin/server/info', { headers: { 'x-session-token': LootGameAPI.getToken() } }).then(r => r.json());
    const memMb = Math.round((info.memory?.heapUsed || 0) / 1024 / 1024);
    const memEl = document.getElementById('ov-machine-memory');
    if (memEl) memEl.textContent = memMb + ' MB';
    const u = Math.floor(info.uptime || 0);
    const h = Math.floor(u/3600), m = Math.floor((u%3600)/60);
    const uptimeEl = document.getElementById('ov-machine-uptime');
    if (uptimeEl) uptimeEl.textContent = h + 'h ' + m + 'm';
  } catch {}
}

// ─── Quick Actions (clearAllCooldowns wird auch vom Cooldowns-Tab genutzt) ────
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
