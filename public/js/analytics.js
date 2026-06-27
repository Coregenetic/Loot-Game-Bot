let currentAnDays = 7;

async function loadAnalytics(days) {
  currentAnDays = days;
  ['1','7','30','0'].forEach(d => {
    const btn = document.getElementById('an-' + d);
    if (!btn) return;
    btn.className = String(d) === String(days)
      ? 'px-3 py-1.5 text-xs font-mono rounded-lg border border-emerald-500 text-emerald-400 bg-emerald-500/10 transition-colors'
      : 'px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-700 text-slate-400 hover:border-emerald-500 hover:text-emerald-400 transition-colors';
  });
  try {
    const url  = `/api/admin/analytics?days=${days > 0 ? days : 3650}`;
    const data = await apiCall(url);
    const s    = data.stats;
    document.getElementById('an-total').textContent    = data.total.toLocaleString('de-DE');
    document.getElementById('an-raids').textContent    = (s.lootStats?.total || 0).toLocaleString('de-DE');
    const surv = s.lootStats?.total > 0 ? Math.round((s.lootStats.survived/s.lootStats.total)*100)+'%' : '—';
    document.getElementById('an-survival').textContent = surv;
    document.getElementById('an-value').textContent    = formatAnValue(s.lootStats?.totalValue || 0);
    const maxBar = (arr) => Math.max(...arr.map(([,v])=>v), 1);
    const cmds = Object.entries(s.byCommand||{}).sort((a,b)=>b[1]-a[1]);
    document.getElementById('an-commands').innerHTML = cmds.map(([cmd,count])=>`
      <div class="flex items-center gap-3">
        <span class="font-mono text-xs text-slate-300 w-24 shrink-0">${cmd}</span>
        <div class="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
          <div class="h-full bg-emerald-500 rounded-full" style="width:${Math.round((count/maxBar(cmds))*100)}%"></div>
        </div>
        <span class="font-mono text-xs text-slate-400 w-10 text-right">${count}</span>
      </div>`).join('');
    const users = Object.entries(s.byUser||{}).sort((a,b)=>b[1]-a[1]).slice(0,8);
    document.getElementById('an-users').innerHTML = users.map(([user,count])=>`
      <div class="flex items-center gap-3">
        <span class="font-mono text-xs text-slate-300 w-28 shrink-0 truncate">${user}</span>
        <div class="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
          <div class="h-full bg-blue-500 rounded-full" style="width:${Math.round((count/maxBar(users))*100)}%"></div>
        </div>
        <span class="font-mono text-xs text-slate-400 w-10 text-right">${count}</span>
      </div>`).join('');
    const hours = s.byHour||new Array(24).fill(0);
    const maxH  = Math.max(...hours, 1);
    document.getElementById('an-hours').innerHTML = hours.map((h,i)=>`
      <div class="flex-1 bg-slate-800 rounded-sm relative" title="${i}:00 — ${h}x">
        <div class="absolute bottom-0 left-0 right-0 bg-purple-500 rounded-sm" style="height:${Math.round((h/maxH)*100)}%;opacity:0.8"></div>
      </div>`).join('');
    const items   = Object.entries(s.lootStats?.topItems||{}).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const maxItem = items[0]?.[1]||1;
    document.getElementById('an-items').innerHTML = items.length ? items.map(([name,count])=>`
      <div class="flex items-center gap-3">
        <span class="font-mono text-xs text-slate-300 flex-1 truncate" title="${name}">${name}</span>
        <div class="w-20 h-2 bg-slate-800 rounded-full overflow-hidden">
          <div class="h-full bg-amber-500 rounded-full" style="width:${Math.round((count/maxItem)*100)}%"></div>
        </div>
        <span class="font-mono text-xs text-slate-400 w-8 text-right">${count}x</span>
      </div>`).join('')
      : '<p class="text-xs font-mono text-slate-600">Noch keine Loot-Daten</p>';
  } catch(err) { console.error('Analytics:', err); }
}

function formatAnValue(v) {
  if (!v) return '0 ₽';
  if (v >= 1e9) return (v/1e9).toFixed(1)+'B ₽';
  if (v >= 1e6) return (v/1e6).toFixed(1)+'M ₽';
  if (v >= 1e3) return (v/1e3).toFixed(0)+'K ₽';
  return v+' ₽';
}

// ─── Recap-Karte ──────────────────────────────────────────────────────────────
let recapData = null;

function formatDe(dateStr) {
  const [y,m,d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

async function generateRecap() {
  const from = document.getElementById('recap-from').value;
  const to   = document.getElementById('recap-to').value;
  if (!from || !to) { showToast('Bitte Von- und Bis-Datum wählen', 'error'); return; }

  try {
    const data = await apiCall(`/api/admin/recap?from=${from}&to=${to}`);
    recapData = data;

    document.getElementById('recap-daterange').textContent = `${formatDe(from)} – ${formatDe(to)}`;
    document.getElementById('recap-raids').textContent     = data.totalRaids.toLocaleString('de-DE');
    document.getElementById('recap-survival').textContent  = data.survivalRate + '%';
    document.getElementById('recap-loot').textContent      = formatAnValue(data.totalValue);
    document.getElementById('recap-map').textContent       = data.topMap ? data.topMap.name : '—';

    const looterAvatar = document.getElementById('recap-looter-avatar');
    if (data.topLooter) {
      looterAvatar.textContent = data.topLooter.username.slice(0,2).toUpperCase();
      document.getElementById('recap-looter-name').textContent  = data.topLooter.username;
      document.getElementById('recap-looter-value').textContent = '+' + formatAnValue(data.topLooter.value);
    } else {
      looterAvatar.textContent = '—';
      document.getElementById('recap-looter-name').textContent  = 'Keine Daten';
      document.getElementById('recap-looter-value').textContent = '—';
    }

    if (data.biggestDrop) {
      document.getElementById('recap-drop-name').textContent  = data.biggestDrop.itemName || '—';
      document.getElementById('recap-drop-value').textContent = formatAnValue(data.biggestDrop.value) + ' · ' + data.biggestDrop.username;
    } else {
      document.getElementById('recap-drop-name').textContent  = 'Keine Daten';
      document.getElementById('recap-drop-value').textContent = '—';
    }

    document.getElementById('recap-empty').classList.add('hidden');
    document.getElementById('recap-preview').classList.remove('hidden');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

async function renderRecapCanvas() {
  const el = document.getElementById('recap-card');
  return await html2canvas(el, { backgroundColor: '#05080c', scale: 2 });
}

async function downloadRecap() {
  try {
    const canvas = await renderRecapCanvas();
    const link = document.createElement('a');
    link.download = `loot-recap_${recapData.from}_${recapData.to}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    showToast('Fehler beim Export: ' + err.message, 'error');
  }
}

async function copyRecap() {
  try {
    const canvas = await renderRecapCanvas();
    canvas.toBlob(async (blob) => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast('Recap-Karte in Zwischenablage kopiert', 'success');
      } catch (err) {
        showToast('Kopieren nicht möglich — bitte Download nutzen', 'error');
      }
    }, 'image/png');
  } catch (err) {
    showToast('Fehler beim Export: ' + err.message, 'error');
  }
}

// ─── Turnier-Modus ────────────────────────────────────────────────────────────
