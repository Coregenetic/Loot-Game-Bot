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

  let hetznerCpuChart = null;

  try {
    const [status, metrics] = await Promise.all([
      fetch('/api/admin/hetzner/status', { headers: { 'x-session-token': LootGameAPI.getToken() } }).then(r => r.json()),
      fetch('/api/admin/hetzner/metrics', { headers: { 'x-session-token': LootGameAPI.getToken() } }).then(r => r.json())
    ]);

    const statusEl = document.getElementById('ov-hetzner-status');
    if (statusEl) {
      const running = status.status === 'running';
      statusEl.textContent = running ? '● Online' : '○ ' + (status.status || '—');
      statusEl.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full ' +
        (running ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                 : 'bg-rose-500/10 text-rose-400 border border-rose-500/20');
    }

    const cpuEl = document.getElementById('ov-cpu-label');
    if (cpuEl && metrics.cpu !== null) cpuEl.textContent = metrics.cpu.toFixed(1) + '%';

    if (metrics.ram) {
      const usedGb = parseFloat((metrics.ram.totalGb - metrics.ram.freeGb).toFixed(1));
      const ramEl  = document.getElementById('ov-ram-label');
      if (ramEl) ramEl.textContent = usedGb + ' / ' + metrics.ram.totalGb + ' GB';
    }

    if (metrics.disk?.totalGb) {
      const usedGb  = parseFloat((metrics.disk.totalGb - metrics.disk.freeGb).toFixed(1));
      const diskEl  = document.getElementById('ov-disk-label');
      if (diskEl) diskEl.textContent = usedGb + ' / ' + metrics.disk.totalGb + ' GB';
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
