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
    const [status, metrics] = await Promise.all([
      fetch('/api/admin/hetzner/status', { headers: { 'x-session-token': LootGameAPI.getToken() } }).then(r => r.json()),
      fetch('/api/admin/hetzner/metrics', { headers: { 'x-session-token': LootGameAPI.getToken() } }).then(r => r.json())
    ]);

    const statusEl = document.getElementById('ov-hetzner-status');
    if (statusEl) {
      const running = status.status === 'running';
      statusEl.textContent = running ? '● Online' : '○ ' + (status.status || 'Unbekannt');
      statusEl.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full ' +
        (running ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                 : 'bg-rose-500/10 text-rose-400 border border-rose-500/20');
    }

    const ramEl = document.getElementById('ov-ram-label');
    if (ramEl) ramEl.textContent = (status.memory || '—') + ' GB DDR5';

    const locEl = document.getElementById('ov-location-label');
    if (locEl) locEl.textContent = status.location || '—';

    if (metrics.cpu !== null && metrics.cpu !== undefined) {
      const cpuLabel = document.getElementById('ov-cpu-label');
      const cpuBar   = document.getElementById('ov-cpu-bar');
      if (cpuLabel) cpuLabel.textContent = metrics.cpu.toFixed(1) + '%';
      if (cpuBar)   cpuBar.style.width = Math.min(metrics.cpu, 100) + '%';
      if (cpuBar)   cpuBar.className = 'h-full rounded-full transition-all ' +
        (metrics.cpu > 80 ? 'bg-rose-500' : metrics.cpu > 50 ? 'bg-amber-500' : 'bg-emerald-500');
    }

    // Reboot-Button nur für Superadmin sichtbar
    const rebootBtn = document.getElementById('ov-reboot-btn');
    if (rebootBtn && currentUser?.role === 'superadmin') {
      rebootBtn.classList.remove('hidden');
    }
  } catch {}
}

// ─── Hetzner Quick Controls ───────────────────────────────────────────────────
async function hetznerRestartBot() {
  showConfirm('Bot neu starten?', 'Der Bot-Container wird neu gestartet. Für ~10 Sekunden ist der Bot offline.', async () => {
    const msgEl = document.getElementById('ov-hetzner-msg');
    try {
      const r = await fetch('/api/admin/hetzner/restart-bot', { method: 'POST', headers: { 'x-session-token': LootGameAPI.getToken() } }).then(r => r.json());
      if (msgEl) { msgEl.textContent = '✓ ' + r.message; msgEl.style.color = 'var(--green)'; }
      setTimeout(loadOverview, 12000);
    } catch (e) {
      if (msgEl) { msgEl.textContent = '✗ ' + e.message; msgEl.style.color = 'var(--red)'; }
    }
  });
}

async function hetznerRebootServer() {
  showConfirm('Server neu starten?', '⚠️ Der gesamte Server wird neu gestartet. Der Bot ist für 1-2 Minuten offline.', async () => {
    const msgEl = document.getElementById('ov-hetzner-msg');
    try {
      const r = await fetch('/api/admin/hetzner/reboot', { method: 'POST', headers: { 'x-session-token': LootGameAPI.getToken() } }).then(r => r.json());
      if (msgEl) { msgEl.textContent = '✓ ' + r.message; msgEl.style.color = 'var(--green)'; }
    } catch (e) {
      if (msgEl) { msgEl.textContent = '✗ ' + e.message; msgEl.style.color = 'var(--red)'; }
    }
  });
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
