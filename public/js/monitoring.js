let monChart = null;
let monWs    = null;
const MON_WINDOW = 60;

function startMonitoringLive() {
  _monConnectWs();
}

function stopMonitoringLive() {
  if (monWs) { monWs.close(); monWs = null; }
  if (monChart) { monChart.destroy(); monChart = null; }
}

function _monConnectWs() {
  if (monWs && monWs.readyState === WebSocket.OPEN) return;
  const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/admin?token=' + encodeURIComponent(LootGameAPI.getToken());
  monWs = new WebSocket(wsUrl);
  monWs.onopen = () => {};
  monWs.onmessage = (e) => {
    try { const msg = JSON.parse(e.data); if (msg.type === 'server_metrics') _monApply(msg); } catch {}
  };
  monWs.onclose = () => {
    if (activeTab === 'monitoring') setTimeout(_monConnectWs, 3000);
  };
}

function _monApply(m) {
  const now = new Date(m.ts);
  const ts  = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0') + ':' + now.getSeconds().toString().padStart(2,'0');
  const el = (id) => document.getElementById(id);
  const set = (id, val) => { const e = el(id); if (e) e.textContent = val; };

  set('mon-timestamp', 'aktualisiert: ' + ts);

  if (m.cpu !== null && m.cpu !== undefined) {
    const cpuColor = m.cpu > 80 ? '#f87171' : m.cpu > 50 ? '#fbbf24' : '#10b981';
    set('mon-cpu-val', m.cpu.toFixed(1) + '%');
    set('mon-cpu-graph-val', m.cpu.toFixed(1) + '%');
    if (el('mon-cpu-val')) el('mon-cpu-val').style.color = cpuColor;
    if (el('mon-cpu-graph-val')) el('mon-cpu-graph-val').style.color = cpuColor;

    const canvas = el('mon-cpu-chart');
    if (canvas) {
      if (!monChart) {
        monChart = new Chart(canvas, {
          type: 'line',
          data: { labels: [], datasets: [{ data: [], borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', borderWidth: 1.5, pointRadius: 0, tension: 0.2, fill: true }] },
          options: {
            responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.parsed.y.toFixed(1) + '%' } } },
            scales: { x: { display: false }, y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#475569', font: { size: 9, family: 'JetBrains Mono' }, callback: v => v + '%', maxTicksLimit: 5 } } }
          }
        });
      }
      monChart.data.labels.push(ts);
      monChart.data.datasets[0].data.push(m.cpu);
      if (monChart.data.labels.length > MON_WINDOW) { monChart.data.labels.shift(); monChart.data.datasets[0].data.shift(); }
      const avg = monChart.data.datasets[0].data.slice(-5).reduce((a,b)=>a+b,0) / Math.min(5, monChart.data.datasets[0].data.length);
      const color = avg > 80 ? '#f87171' : avg > 50 ? '#fbbf24' : '#10b981';
      monChart.data.datasets[0].borderColor = color;
      monChart.data.datasets[0].backgroundColor = avg > 80 ? 'rgba(248,113,113,0.08)' : avg > 50 ? 'rgba(251,191,36,0.08)' : 'rgba(16,185,129,0.08)';
      monChart.update('none');
    }
  }

  if (m.ram) {
    const usedGb = parseFloat((m.ram.usedMb / 1024).toFixed(2));
    const totalGb = parseFloat((m.ram.totalMb / 1024).toFixed(1));
    set('mon-ram-val', usedGb + ' GB');
    set('mon-ram-sub', 'von ' + totalGb + ' GB');
    set('mon-ram-detail', m.ram.usedMb + ' / ' + m.ram.totalMb + ' MB (' + m.ram.pct + '%)');
    const ramBar = el('mon-ram-bar');
    if (ramBar) { ramBar.style.width = m.ram.pct + '%'; ramBar.style.background = m.ram.pct > 80 ? '#f87171' : '#60a5fa'; }
  }

  if (m.heap) {
    set('mon-heap-val', m.heap.usedMb + ' MB');
    set('mon-heap-sub', m.heap.pct + '% des Heaps');
    set('mon-heap-detail', m.heap.usedMb + ' / ' + m.heap.totalMb + ' MB (' + m.heap.pct + '%)');
    const heapBar = el('mon-heap-bar');
    if (heapBar) heapBar.style.width = m.heap.pct + '%';
  }

  if (m.disk) {
    set('mon-disk-val', m.disk.usedGb + ' GB');
    set('mon-disk-sub', 'von ' + m.disk.totalGb + ' GB');
    set('mon-disk-detail', m.disk.usedGb + ' / ' + m.disk.totalGb + ' GB (' + m.disk.pct + '%)');
    set('mon-disk-free', m.disk.freeGb + ' GB frei');
    const diskBar = el('mon-disk-bar');
    if (diskBar) { diskBar.style.width = m.disk.pct + '%'; diskBar.style.background = m.disk.pct > 80 ? '#f87171' : '#f59e0b'; }
  }

  if (m.net) {
    set('mon-net-in',  m.net.rxKbs.toFixed(1));
    set('mon-net-out', m.net.txKbs.toFixed(1));
  }
}
