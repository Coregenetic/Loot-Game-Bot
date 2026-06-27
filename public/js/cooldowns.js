async function loadCooldowns() {
  try {
    const players = await fetch('/api/players', { headers:{'x-session-token':LootGameAPI.getToken()} }).then(r => r.json());
    allCDs = players;
    renderCooldowns('');
  } catch {}
}

function filterCooldowns(q) { renderCooldowns(q.toLowerCase()); }

function renderCooldowns(q) {
  const filtered = allCDs.filter(p => p.username.toLowerCase().includes(q));
  document.getElementById('cdCount').textContent = filtered.length + ' Spieler';
  const el = document.getElementById('cooldownList');
  if (!filtered.length) { el.innerHTML = '<div class="p-4 text-xs font-mono text-slate-500 text-center">Keine Einträge gefunden.</div>'; return; }
  
  el.innerHTML = filtered.map(p =>
    '<div class="flex items-center justify-between p-3 border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">' +
    '<div class="flex items-center gap-3"><span class="text-slate-200 font-medium text-sm">' + p.username + '</span> <span class="text-[10px] text-slate-400 font-mono tracking-wider bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800">Lvl ' + (p.level||1) + ' P' + (p.prestige||0) + '</span></div>' +
    '<div class="flex items-center gap-5">' +
    '<span class="text-emerald-400 font-mono text-xs font-medium">' + formatVal(p.stash_value) + ' ₽</span>' +
    '<button class="px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20 text-[10px] font-bold tracking-wider transition-colors" onclick="clearUserCD(\'' + p.username + '\')">CD RESET</button>' +
    '</div></div>'
  ).join('');
}

async function clearUserCD(username) {
  try {
    await fetch('/api/admin/cooldowns/' + username, { method:'DELETE', headers:{'x-session-token':LootGameAPI.getToken()} });
    showToast('✓ CD für ' + username + ' gelöscht', 'success');
    loadCooldowns();
  } catch {}
}

