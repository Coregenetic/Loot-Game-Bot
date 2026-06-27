function updateLogStatus(online) {
  const el = document.getElementById('logStatus');
  if(online) {
    el.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]"></span><span class="text-emerald-400">LOG LIVE</span>';
    el.className = "flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded transition-colors";
  } else {
    el.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-500"></span><span class="text-slate-400">LOG OFFLINE</span>';
    el.className = "flex items-center gap-2 bg-slate-900/50 border border-slate-800 px-3 py-1.5 rounded transition-colors";
  }
}

function startLogPoll() {
  if (logPoll) return;
  fetchLogs(true);
  logPoll = setInterval(() => fetchLogs(false), 2000);
  updateLogStatus(true);
}

async function fetchLogs(initial) {
  try {
    const logs = await fetch('/api/logs', { headers:{'x-session-token':LootGameAPI.getToken()} }).then(r => r.json());
    if (initial) {
      allLogs = logs;
      updateCategoryFilterOptions();
      renderAllLogs();
    } else {
      const newOnes = logs.slice(allLogs.length);
      for (const l of newOnes) { allLogs.push(l); appendLogLine(l); }
      if (newOnes.length) updateCategoryFilterOptions();
    }
  } catch { updateLogStatus(false); }
}

function updateCategoryFilterOptions() {
  const select = document.getElementById('categoryFilter');
  if (!select) return;
  const categories = [...new Set(allLogs.map(l => l.category).filter(Boolean))].sort();
  const current = select.value;
  select.innerHTML = '<option value="ALL">Alle Quellen</option>' +
    categories.map(c => `<option value="${c}">${c}</option>`).join('');
  if (categories.includes(current)) select.value = current;
}

function setFilter(f) {
  logFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.remove('bg-slate-800', 'text-white', 'border-slate-500');
    b.classList.add('text-slate-400', 'border-slate-700');
  });
  
  const btn = document.getElementById('filter-' + f);
  if (btn) {
    btn.classList.remove('text-slate-400', 'border-slate-700');
    // Using simple active style to avoid complex color mapping in Tailwind classes on the fly
    btn.classList.add('bg-slate-800', 'text-white', 'border-slate-500');
  }
  renderAllLogs();
}

function setCategoryFilter(c) {
  categoryFilter = c;
  renderAllLogs();
}

function matchesFilter(l) {
  if (logFilter !== 'ALL' && l.level !== logFilter) return false;
  if (categoryFilter !== 'ALL' && l.category !== categoryFilter) return false;
  return true;
}

function renderAllLogs() {
  const c = document.getElementById('logContainer');
  const filtered = allLogs.filter(matchesFilter);
  c.innerHTML = filtered.map(logLineHTML).join('');
  if (document.getElementById('autoScroll')?.checked) c.scrollTop = c.scrollHeight;
}

function appendLogLine(entry) {
  if (!matchesFilter(entry)) return;
  const c = document.getElementById('logContainer');
  c.insertAdjacentHTML('beforeend', logLineHTML(entry));
  if (document.getElementById('autoScroll')?.checked) c.scrollTop = c.scrollHeight;
}

function formatLogTime(ts) {
  if (!ts) return '--:--:--';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function logLineHTML(e) {
  const isEventSub = (e.category || '').toUpperCase().includes('EVENTSUB') || (e.category || '').toUpperCase().includes('TWITCH-AUTH');
  const rowExtra = isEventSub ? 'border-l-2 border-l-purple-500 bg-purple-500/[0.04]' : '';
  const catColor = isEventSub ? 'text-purple-400' : 'text-slate-500';
  return '<div class="py-1.5 pl-2 border-b border-slate-800/30 hover:bg-slate-800/20 flex gap-4 font-mono text-[11px] leading-relaxed break-all log-line log-' + e.level + ' ' + rowExtra + '">' +
    '<span class="text-slate-500 shrink-0 w-20 tabular-nums">' + formatLogTime(e.ts) + '</span>' +
    '<span class="font-bold shrink-0 w-12 log-level-color">' + e.level + '</span>' +
    '<span class="' + catColor + ' shrink-0 w-28 truncate">[' + (e.category||'') + ']</span>' +
    '<span class="text-slate-300 log-msg-color">' + escHtml(e.message||'') + '</span></div>';
}

function clearLogDisplay() { document.getElementById('logContainer').innerHTML = ''; allLogs = []; }

// ─── Cooldowns ────────────────────────────────────────────────────────────────
