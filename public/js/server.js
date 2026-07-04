function switchServerSubtab(name) {
  document.querySelectorAll('.srv-subtab').forEach(el => el.classList.toggle('active', el.dataset.srvtab === name));
  ['infra', 'actions', 'behavior', 'commands', 'backups'].forEach(t => {
    const el = document.getElementById('srvtab-' + t);
    if (el) el.classList.toggle('hidden', t !== name);
  });
}

let htzCpuChart = null;
let htzRefreshInterval = null;
let metricsWs = null;
const CPU_WINDOW = 60; // Datenpunkte im Chart (60 x 2s = 2 Minuten)

function startHetznerLive() {
  // Einmalig Status + Basis-Infos via HTTP holen (läuft nicht so oft)
  loadHetznerStatus();

  // Echtzeit-Metriken via WebSocket
  startMetricsWs();
}

function stopHetznerLive() {
  if (metricsWs) { metricsWs.close(); metricsWs = null; }
  if (htzRefreshInterval) { clearInterval(htzRefreshInterval); htzRefreshInterval = null; }
  if (htzCpuChart) { htzCpuChart.destroy(); htzCpuChart = null; }
}

function startMetricsWs() {
  if (metricsWs && metricsWs.readyState === WebSocket.OPEN) return;

  const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/admin';
  metricsWs = new WebSocket(wsUrl);

  metricsWs.onopen = () => {
    const token = LootGameAPI.getToken();
    if (token) metricsWs.send(JSON.stringify({ type: 'auth', token }));
  };

  metricsWs.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'server_metrics') applyMetrics(msg);
    } catch {}
  };

  metricsWs.onclose = () => {
    // Reconnect nach 3s falls Server-Tab noch offen
    if (activeTab === 'server') setTimeout(startMetricsWs, 3000);
  };
}

async function loadHetznerStatus() {
  try {
    const status = await fetch('/api/admin/hetzner/status', {
      headers: { 'x-session-token': LootGameAPI.getToken() }
    }).then(r => r.json());

    const statusEl = document.getElementById('htz-status');
    if (statusEl) {
      const running = status.status === 'running';
      statusEl.textContent = running ? '● Running' : '○ ' + (status.status || '—');
      statusEl.className = 'text-[10px] font-mono px-2.5 py-1 rounded-full ' +
        (running ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                 : 'bg-rose-500/10 text-rose-400 border border-rose-500/20');
    }
    const sub = document.getElementById('htz-subtitle');
    if (sub && status.location) sub.textContent = 'CoresServer · ' + status.location + ', DE';

    const rebootBtn = document.getElementById('htz-reboot-btn');
    if (rebootBtn && currentUser?.role === 'superadmin') rebootBtn.classList.remove('hidden');
  } catch {}
}

function applyMetrics(m) {
  const now = new Date(m.ts);
  const timeLabel = now.getHours().toString().padStart(2,'0') + ':' +
                    now.getMinutes().toString().padStart(2,'0') + ':' +
                    now.getSeconds().toString().padStart(2,'0');

  // ─── CPU ───────────────────────────────────────────────────────────────────
  if (m.cpu !== null && m.cpu !== undefined) {
    const cpuVal = document.getElementById('htz-cpu-val');
    if (cpuVal) {
      cpuVal.textContent = m.cpu.toFixed(1) + '%';
      cpuVal.style.color = m.cpu > 80 ? '#f87171' : m.cpu > 50 ? '#fbbf24' : '#10b981';
    }

    const canvas = document.getElementById('htz-cpu-chart');
    if (canvas) {
      if (!htzCpuChart) {
        htzCpuChart = new Chart(canvas, {
          type: 'line',
          data: {
            labels: [],
            datasets: [{
              data: [],
              borderColor: '#10b981',
              backgroundColor: 'rgba(16,185,129,0.08)',
              borderWidth: 1.5,
              pointRadius: 0,
              tension: 0.2,
              fill: true
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            animation: { duration: 200 },
            plugins: { legend: { display: false },
              tooltip: { callbacks: { label: ctx => ctx.parsed.y.toFixed(1) + '%' } }
            },
            scales: {
              x: { display: false },
              y: { min: 0, max: 100,
                grid: { color: 'rgba(255,255,255,0.04)' },
                ticks: { color: '#475569', font: { size: 9, family: 'JetBrains Mono' },
                  callback: v => v + '%', maxTicksLimit: 5 }
              }
            }
          }
        });
      }

      htzCpuChart.data.labels.push(timeLabel);
      htzCpuChart.data.datasets[0].data.push(m.cpu);
      if (htzCpuChart.data.labels.length > CPU_WINDOW) {
        htzCpuChart.data.labels.shift();
        htzCpuChart.data.datasets[0].data.shift();
      }
      // Farbe dynamisch je nach Last
      const avg = htzCpuChart.data.datasets[0].data.slice(-5).reduce((a,b)=>a+b,0)/5;
      htzCpuChart.data.datasets[0].borderColor = avg > 80 ? '#f87171' : avg > 50 ? '#fbbf24' : '#10b981';
      htzCpuChart.data.datasets[0].backgroundColor = avg > 80 ? 'rgba(248,113,113,0.08)' : avg > 50 ? 'rgba(251,191,36,0.08)' : 'rgba(16,185,129,0.08)';
      htzCpuChart.update('none');
    }
  }

  // ─── Netzwerk ───────────────────────────────────────────────────────────────
  if (m.net) {
    const netIn  = document.getElementById('htz-net-in');
    const netOut = document.getElementById('htz-net-out');
    if (netIn)  netIn.textContent  = m.net.rxKbs.toFixed(1);
    if (netOut) netOut.textContent = m.net.txKbs.toFixed(1);
  }

  // ─── Heap ───────────────────────────────────────────────────────────────────
  if (m.heap) {
    const heapBar = document.getElementById('htz-heap-bar');
    const heapLbl = document.getElementById('htz-heap-label');
    if (heapBar) heapBar.style.width = m.heap.pct + '%';
    if (heapLbl) heapLbl.textContent = m.heap.usedMb + ' / ' + m.heap.totalMb + ' MB';
  }

  // ─── RAM ────────────────────────────────────────────────────────────────────
  if (m.ram) {
    const usedGb  = parseFloat((m.ram.usedMb / 1024).toFixed(2));
    const totalGb = parseFloat((m.ram.totalMb / 1024).toFixed(1));
    const ramBar  = document.getElementById('htz-ram-bar');
    const ramLbl  = document.getElementById('htz-ram-label');
    const ramUsed = document.getElementById('htz-ram-used');
    const ramPctEl = document.getElementById('htz-ram-pct');
    if (ramBar)  { ramBar.style.width = m.ram.pct + '%'; ramBar.style.background = m.ram.pct > 80 ? '#f87171' : '#60a5fa'; }
    if (ramLbl)  ramLbl.textContent  = totalGb + ' GB gesamt';
    if (ramUsed) ramUsed.textContent = usedGb + ' GB genutzt';
    if (ramPctEl) ramPctEl.textContent = m.ram.pct + '%';
  }

  // ─── Disk ────────────────────────────────────────────────────────────────────
  if (m.disk) {
    const bar   = document.getElementById('htz-disk-bar');
    const lbl   = document.getElementById('htz-disk-label');
    const used  = document.getElementById('htz-disk-used');
    const pctEl = document.getElementById('htz-disk-pct');
    if (bar)   { bar.style.width = m.disk.pct + '%'; bar.style.background = m.disk.pct > 80 ? '#f87171' : '#10b981'; }
    if (lbl)   lbl.textContent  = m.disk.totalGb + ' GB gesamt';
    if (used)  used.textContent = m.disk.usedGb + ' GB genutzt';
    if (pctEl) pctEl.textContent = m.disk.pct + '% · ' + m.disk.freeGb + ' GB frei';
  }

  // ─── Timestamp ───────────────────────────────────────────────────────────────
  const updEl = document.getElementById('htz-last-update');
  if (updEl) updEl.textContent = 'Live · ' + timeLabel;
}

async function hetznerRestartBot() {
  showConfirm('Bot neu starten?', 'Der Bot-Container wird neu gestartet. Für ~10 Sekunden offline.', async () => {
    const msg = document.getElementById('htz-action-msg');
    try {
      const r = await fetch('/api/admin/hetzner/restart-bot', { method: 'POST', headers: { 'x-session-token': LootGameAPI.getToken() } }).then(r => r.json());
      if (msg) { msg.textContent = '✓ ' + r.message; msg.style.color = 'var(--green)'; }
      setTimeout(loadHetznerStatus, 12000);
    } catch (e) {
      if (msg) { msg.textContent = '✗ ' + e.message; msg.style.color = 'var(--red)'; }
    }
  });
}

async function hetznerRebootServer() {
  showConfirm('Server neu starten?', '⚠️ Der gesamte Server wird neu gestartet. Bot ~1-2 Min. offline.', async () => {
    const msg = document.getElementById('htz-action-msg');
    try {
      const r = await fetch('/api/admin/hetzner/reboot', { method: 'POST', headers: { 'x-session-token': LootGameAPI.getToken() } }).then(r => r.json());
      if (msg) { msg.textContent = '✓ ' + r.message; msg.style.color = 'var(--green)'; }
    } catch (e) {
      if (msg) { msg.textContent = '✗ ' + e.message; msg.style.color = 'var(--red)'; }
    }
  });
}

// ─── Server Control ───────────────────────────────────────────────────────────
async function checkServerAccess() {
  try {
    const res = await fetch('/api/admin/server/access-check', { headers: { 'x-session-token': LootGameAPI.getToken() } });
    if (res.status === 401 || res.status === 403) {
      document.getElementById('serverLock').classList.remove('hidden');
      document.getElementById('serverPanel').classList.add('hidden');
      return;
    }
    serverPw = 'ok'; // Platzhalter — Absicherung läuft jetzt serverseitig über die Permission, nicht über dieses Feld
    document.getElementById('serverLock').classList.add('hidden');
    document.getElementById('serverPanel').classList.remove('hidden');
    loadServerInfo();
    loadChannels();
    loadCommands_panel();
    startHetznerLive();
    loadMaintenance();
    loadTournament();
    loadSellRate();
    loadBackups();
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

async function loadServerInfo() {
  if (!serverPw) return;
  try {
    const info = await fetch('/api/admin/server/info',{headers:{'x-session-token':LootGameAPI.getToken()}}).then(r=>r.json());
    const u = Math.floor(info.uptime), h=Math.floor(u/3600), m=Math.floor((u%3600)/60), s=u%60;
    document.getElementById('srvUptime').textContent  = h+'h '+m+'m '+s+'s';
    document.getElementById('srvMem').textContent     = Math.round(info.memory.heapUsed/1024/1024)+' MB';
    document.getElementById('srvNode').textContent    = info.node||'—';
    document.getElementById('srvChannel').textContent = '#'+(info.channel||'—');
  } catch {}
}

async function serverAction(action) {
  if (!serverPw) return;
  const labels = {reconnect:'Bot Reconnect',cache:'Cache leeren',snapshot:'DB Snapshot'};
  
  showConfirm('Server Action', labels[action] + ' wirklich ausführen?', async () => {
    const result = document.getElementById('serverActionResult');
    result.classList.remove('hidden');
    result.classList.replace('text-rose-400', 'text-amber-400');
    result.classList.replace('text-emerald-400', 'text-amber-400');
    result.classList.replace('border-rose-500/30', 'border-slate-700');
    result.classList.replace('border-emerald-500/30', 'border-slate-700');
    result.textContent = '⟳ Führe aus: '+labels[action]+'...';
    
    try {
      const res = await fetch('/api/admin/server/'+action,{method:'POST',headers:{'Content-Type':'application/json','x-session-token':LootGameAPI.getToken()},body:JSON.stringify({password:serverPw})});
      const d = await res.json();
      
      result.textContent = d.success ? '✓ '+d.message : '✗ '+(d.error||'Fehler');
      
      if(d.success) {
        result.classList.replace('text-amber-400', 'text-emerald-400');
        result.classList.replace('border-slate-700', 'border-emerald-500/30');
      } else {
        result.classList.replace('text-amber-400', 'text-rose-400');
        result.classList.replace('border-slate-700', 'border-rose-500/30');
      }
    } catch(e) { 
      result.textContent='✗ '+e.message; 
      result.classList.replace('text-amber-400', 'text-rose-400');
      result.classList.replace('border-slate-700', 'border-rose-500/30');
    }
  });
}

// ─── Spieler ──────────────────────────────────────────────────────────────────
function formatBackupDate(ts) {
  const d = new Date(ts);
  const now = Date.now();
  const diffMin = Math.round((now - ts) / 60000);
  if (diffMin < 1) return 'gerade eben';
  if (diffMin < 60) return 'vor ' + diffMin + ' Min';
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return 'vor ' + diffH + 'h · ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' · ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

const SELECTIVE_RESTORE_TABLES = {
  items: 'Items', messages: 'Nachrichten', config: 'Config (General/Maps/Leveling/Events)', role_permissions: 'Rollen-Rechte'
};
const TABLE_LABELS = {
  players: 'Spieler', inventory: 'Inventar', items: 'Items', messages: 'Nachrichten',
  cooldowns: 'Cooldowns', config: 'Config', dashboard_users: 'Dashboard-User',
  role_permissions: 'Rollen-Rechte', audit_log: 'Audit-Log'
};

async function loadBackups() {
  try {
    const backups = await apiCall('/api/admin/backups');
    const el = document.getElementById('backupList');
    if (!backups.length) {
      el.innerHTML = '<p class="text-xs font-mono text-slate-500">Noch keine Backups vorhanden</p>';
      return;
    }
    el.innerHTML = backups.map((b, i) => {
      const sizeKb = Math.round(b.size / 1024);
      const labelMatch = b.filename.match(/_([a-z-]+)\.db$/);
      const label = labelMatch ? labelMatch[1] : 'unknown';
      const labelColors = {
        auto: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
        manual: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
        startup: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
        'before-restore': 'text-amber-400 bg-amber-500/10 border-amber-500/20',
        'before-table-restore': 'text-amber-400 bg-amber-500/10 border-amber-500/20'
      };
      const labelClass = labelColors[label] || 'text-slate-400 bg-slate-800 border-slate-700';

      return `
        <div class="rounded-lg bg-slate-900/50 border border-slate-800/60 hover:border-slate-700 transition-colors overflow-hidden" data-filename="${b.filename}">
          <div class="flex items-center justify-between px-3 py-2">
            <div class="flex items-center gap-3 min-w-0">
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded border flex-shrink-0 ${labelClass}">${label}</span>
              <div class="min-w-0">
                <div class="text-xs font-mono text-slate-200 truncate">${formatBackupDate(b.createdAt)}</div>
              </div>
              <span class="text-[10px] font-mono text-slate-600 flex-shrink-0">${sizeKb} KB</span>
            </div>
            <div class="flex gap-1 flex-shrink-0">
              <button onclick="toggleBackupDetails(${i})" title="Inspizieren" class="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-700/30 border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              </button>
              <button onclick="downloadBackup('${b.filename}')" title="Download" class="w-7 h-7 flex items-center justify-center rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 transition-colors">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              </button>
              <button onclick="restoreBackupConfirm('${b.filename}')" title="Komplett wiederherstellen" class="w-7 h-7 flex items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
              </button>
              <button onclick="deleteBackupConfirm('${b.filename}')" title="Löschen" class="w-7 h-7 flex items-center justify-center rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 transition-colors">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </div>
          <div id="backup-detail-${i}" class="hidden border-t border-slate-800/60 px-3 py-3 bg-slate-950/40"></div>
        </div>`;
    }).join('');
    window._backupFiles = backups.map(b => b.filename);
  } catch (err) {
    document.getElementById('backupList').innerHTML = '<p class="text-xs font-mono text-rose-400">Fehler: ' + err.message + '</p>';
  }
}

async function toggleBackupDetails(i) {
  const panel = document.getElementById('backup-detail-' + i);
  if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }

  const filename = window._backupFiles[i];
  panel.classList.remove('hidden');
  panel.innerHTML = '<p class="text-xs font-mono text-slate-500">Lade...</p>';

  try {
    const data = await apiCall('/api/admin/backups/' + filename + '/inspect');
    const counts = data.tables;
    const rows = Object.entries(counts).map(([table, count]) => `
      <div class="flex items-center justify-between py-1">
        <span class="text-xs text-slate-400">${TABLE_LABELS[table] || table}</span>
        <span class="text-xs font-mono ${count === null ? 'text-slate-600' : 'text-slate-200'} tabular-nums">${count === null ? '—' : count}</span>
      </div>`).join('');

    const checkboxes = Object.entries(SELECTIVE_RESTORE_TABLES).map(([key, label]) => `
      <label class="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
        <input type="checkbox" value="${key}" class="restore-table-cb-${i} accent-amber-500">
        ${label} <span class="text-slate-500 tabular-nums">(${counts[key] ?? 0})</span>
      </label>`).join('');

    panel.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h4 class="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-2">Inhalt dieses Backups</h4>
          ${rows}
        </div>
        <div>
          <h4 class="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-2">Gezielt wiederherstellen</h4>
          <div class="space-y-1.5 mb-3">${checkboxes}</div>
          <button onclick="restoreSelectedTables('${filename}', ${i})" class="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 text-xs font-mono transition-colors">
            Ausgewählte Tabellen wiederherstellen
          </button>
        </div>
      </div>`;
  } catch (err) {
    panel.innerHTML = '<p class="text-xs font-mono text-rose-400">Fehler: ' + err.message + '</p>';
  }
}

async function restoreSelectedTables(filename, i) {
  const checked = [...document.querySelectorAll('.restore-table-cb-' + i + ':checked')].map(cb => cb.value);
  if (!checked.length) { showToast('Bitte mindestens eine Tabelle auswählen', 'warning'); return; }
  if (!confirm(`Tabellen [${checked.join(', ')}] aus "${filename}" wiederherstellen?\n\nNur diese Tabellen werden überschrieben, alles andere bleibt unberührt. Ein Sicherheits-Backup wird automatisch vorher erstellt.`)) return;

  try {
    const res = await fetch('/api/admin/backups/' + filename + '/restore-tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': LootGameAPI.getToken() },
      body: JSON.stringify({ tables: checked })
    });
    const data = await res.json();
    if (data.success) {
      showToast('✓ Wiederherstellt: ' + Object.entries(data.restored).map(([t, c]) => t + ' (' + c + ')').join(', '), 'success');
      loadBackups();
    } else {
      showToast('✗ ' + (data.error || 'Fehler'), 'error');
    }
  } catch (err) { showToast('Fehler: ' + err.message, 'error'); }
}

async function createManualBackup() {
  try {
    const res = await fetch('/api/admin/backups/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': LootGameAPI.getToken() }
    });
    const data = await res.json();
    if (data.success) {
      showToast('✓ Backup erstellt', 'success');
      loadBackups();
    } else {
      showToast('✗ ' + (data.error || 'Fehler'), 'error');
    }
  } catch (err) { showToast('Fehler: ' + err.message, 'error'); }
}

function downloadBackup(filename) {
  window.open('/api/admin/backups/' + filename + '/download', '_blank');
}

async function restoreBackupConfirm(filename) {
  if (!confirm(`Backup "${filename}" wiederherstellen?\n\nALLE aktuellen Daten werden überschrieben! Ein Sicherheits-Backup wird automatisch vorher erstellt.\n\nDer Server muss danach neu gestartet werden.`)) return;
  try {
    const res = await fetch('/api/admin/backups/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': LootGameAPI.getToken() },
      body: JSON.stringify({ filename })
    });
    const data = await res.json();
    if (data.success) {
      showToast('✓ Backup wiederherstellt — bitte Server neu starten', 'success');
      loadBackups();
    } else {
      showToast('✗ ' + (data.error || 'Fehler'), 'error');
    }
  } catch (err) { showToast('Fehler: ' + err.message, 'error'); }
}

async function deleteBackupConfirm(filename) {
  if (!confirm(`Backup "${filename}" löschen?`)) return;
  try {
    const res = await fetch('/api/admin/backups/' + filename, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-session-token': LootGameAPI.getToken() }
    });
    const data = await res.json();
    if (data.success) {
      showToast('✓ Backup gelöscht', 'success');
      loadBackups();
    } else {
      showToast('✗ ' + (data.error || 'Fehler'), 'error');
    }
  } catch (err) { showToast('Fehler: ' + err.message, 'error'); }
}

// ─── Item zu Spieler geben ────────────────────────────────────────────────────
async function loadCommands_panel() {
  try {
    const status = await apiCall('/api/admin/commands');
    const el = document.getElementById('commandList');
    el.innerHTML = Object.entries(status).map(([cmd, active]) => `
      <div class="flex items-center justify-between p-3 rounded-xl bg-slate-900/50 border ${active ? 'border-slate-800' : 'border-slate-800/40'}">
        <span class="text-sm font-mono ${active ? 'text-white' : 'text-slate-500'}">${cmd}</span>
        <div class="flex items-center gap-2.5">
          <span class="text-[10px] font-mono ${active ? 'text-emerald-400' : 'text-slate-500'}">${active ? 'Aktiv' : 'Inaktiv'}</span>
          <label class="cmd-toggle">
            <input type="checkbox" ${active ? 'checked' : ''} onchange="toggleCommand('${cmd}', this.checked)">
            <span class="track"></span>
            <span class="knob"></span>
          </label>
        </div>
      </div>
    `).join('');
  } catch (err) {
    document.getElementById('commandList').innerHTML = '<p class="text-xs font-mono text-rose-400 col-span-2">Fehler: ' + err.message + '</p>';
  }
}

async function toggleCommand(cmd, active) {
  if (!serverPw) return;
  try {
    await fetch('/api/admin/commands/' + encodeURIComponent(cmd), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': LootGameAPI.getToken() },
      body: JSON.stringify({ password: serverPw, active })
    });
    loadCommands_panel();
    showToast(`${cmd} ${active ? 'aktiviert' : 'deaktiviert'}`, active ? 'success' : 'info');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

// ─── Analytics ────────────────────────────────────────────────────────────────
async function loadTournament() {
  try {
    const data = await apiCall('/api/admin/tournament');
    updateTournamentUI(data.active);
    updateDashTournamentBtn(data.active);
  } catch {}
}

async function toggleTournament() {
  try {
    const toggle = document.getElementById('tournamentToggle');
    const desired = toggle.checked; // Toggle hat sich beim Klick schon umgestellt — das ist der Zielzustand
    const res = await fetch('/api/admin/tournament', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': LootGameAPI.getToken() },
      body: JSON.stringify({ active: desired })
    });
    const data = await res.json();
    if (data.success) {
      updateTournamentUI(data.active);
      updateDashTournamentBtn(data.active);
      showToast(data.active ? '🏆 Turnier-Modus aktiviert' : '✅ Turnier-Modus deaktiviert', data.active ? 'info' : 'success');
    } else {
      toggle.checked = !desired; // Server hat abgelehnt -> Toggle zurücksetzen
      showToast('✗ ' + (data.error || 'Fehler'), 'error');
    }
  } catch (err) { showToast('Fehler: ' + err.message, 'error'); }
}

function updateTournamentUI(active) {
  const toggle = document.getElementById('tournamentToggle');
  const status = document.getElementById('tournamentStatus');
  if (!toggle || !status) return; // Server-Control-Tab evtl. noch nicht geladen
  toggle.checked = active;
  status.textContent = active ? 'AKTIV' : 'INAKTIV';
  status.className = active ? 'text-xs font-mono text-blue-400' : 'text-xs font-mono text-emerald-400';
}

// ─── Wartungsmodus ────────────────────────────────────────────────────────────
async function loadSellRate() {
  try {
    const data = await apiCall('/api/admin/game-config');
    const pct = Math.round((data.SellRate ?? 0.8) * 100);
    document.getElementById('sellRateSlider').value = pct;
    document.getElementById('sellRateLabel').textContent = pct + '%';
  } catch (err) { console.error('Konnte Verkaufsrate nicht laden:', err); }
}

function updateSellRateLabel() {
  document.getElementById('sellRateLabel').textContent = document.getElementById('sellRateSlider').value + '%';
}

async function saveSellRate() {
  const pct = parseInt(document.getElementById('sellRateSlider').value);
  try {
    await fetch('/api/admin/game-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-token': LootGameAPI.getToken() },
      body: JSON.stringify({ SellRate: pct / 100 })
    });
    showQuickMsg('✓ Verkaufsrate gespeichert', 'var(--green)');
  } catch (err) {
    showQuickMsg('✗ ' + err.message, 'var(--red)');
  }
}

async function loadMaintenance() {
  try {
    const data = await apiCall('/api/admin/maintenance');
    updateMaintenanceUI(data.active);
  } catch {}
}

async function toggleMaintenance() {
  try {
    const toggle = document.getElementById('maintenanceToggle');
    const desired = toggle.checked;
    const res = await fetch('/api/admin/maintenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': LootGameAPI.getToken() },
      body: JSON.stringify({ active: desired })
    });
    const data = await res.json();
    if (data.success) {
      updateMaintenanceUI(data.active);
      showToast(data.active ? '🔧 Wartungsmodus aktiviert' : '✅ Wartungsmodus deaktiviert', data.active ? 'info' : 'success');
    } else {
      toggle.checked = !desired;
      showToast('✗ ' + (data.error || 'Fehler'), 'error');
    }
  } catch (err) { showToast('Fehler: ' + err.message, 'error'); }
}

function updateMaintenanceUI(active) {
  const toggle = document.getElementById('maintenanceToggle');
  const status = document.getElementById('maintenanceStatus');
  if (!toggle || !status) return; // Server-Control-Tab evtl. noch nicht geladen
  toggle.checked = active;
  status.textContent = active ? 'AKTIV' : 'INAKTIV';
  status.className = active ? 'text-xs font-mono text-amber-400' : 'text-xs font-mono text-emerald-400';
}

// ─── Channel Control ──────────────────────────────────────────────────────────
async function loadChannels() {
  try {
    const status = await apiCall('/api/admin/channels');
    const el = document.getElementById('channelList');
    el.innerHTML = Object.entries(status).map(([ch, active]) => `
      <div class="flex items-center justify-between p-3 rounded-xl bg-slate-900/50 border border-slate-800">
        <div class="flex items-center gap-3">
          <div class="w-2 h-2 rounded-full ${active ? 'bg-emerald-400' : 'bg-slate-600'}"></div>
          <span class="text-sm font-mono text-white">#${ch}</span>
          <span class="text-xs font-mono ${active ? 'text-emerald-400' : 'text-slate-500'}">${active ? 'AKTIV' : 'INAKTIV'}</span>
        </div>
        <button onclick="toggleChannel('${ch}', ${!active})"
          class="px-4 py-1.5 rounded-lg text-xs font-mono transition-colors ${active
            ? 'bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20'
            : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'}">
          ${active ? 'Deaktivieren' : 'Aktivieren'}
        </button>
      </div>
    `).join('');
  } catch (err) {
    document.getElementById('channelList').innerHTML = '<p class="text-xs font-mono text-rose-400">Fehler: ' + err.message + '</p>';
  }
}

async function toggleChannel(channel, active) {
  if (!serverPw) return;
  try {
    await fetch('/api/admin/channels/' + channel, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': LootGameAPI.getToken() },
      body: JSON.stringify({ password: serverPw, active })
    });
    loadChannels();
    showToast(`#${channel} ${active ? 'aktiviert' : 'deaktiviert'}`, active ? 'success' : 'info');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}
