async function loadEvents() {
  try {
    const ev = await fetch('/api/events', { headers:{'x-session-token':LootGameAPI.getToken()} }).then(r => r.json());
    const now = Math.floor(Date.now()/1000);
    const lines = [];
    if (ev.ForcedMap?.MapName && ev.ForcedMap?.ExpiresAt > now)
      lines.push('<span class="text-emerald-400">🗺 FORCED MAP: ' + ev.ForcedMap.MapName + ' (' + Math.round((ev.ForcedMap.ExpiresAt-now)/60) + ' min)</span>');
    if (ev.DoubleLootOverride?.Chance > 0 && ev.DoubleLootOverride?.ExpiresAt > now)
      lines.push('<span class="text-amber-400">🔥 DOUBLE LOOT: ' + (ev.DoubleLootOverride.Chance*100).toFixed(0) + '% (' + Math.round((ev.DoubleLootOverride.ExpiresAt-now)/60) + ' min)</span>');
    if (ev.XPBoost?.Multiplier > 1 && ev.XPBoost?.ExpiresAt > now)
      lines.push('<span class="text-purple-400">⚡ XP BOOST: x' + ev.XPBoost.Multiplier + ' (' + Math.round((ev.XPBoost.ExpiresAt-now)/60) + ' min)</span>');
    
    const el = document.getElementById('eventsStatusBar');
    if(lines.length) {
      el.innerHTML = lines.join('<span class="mx-3 text-slate-600">|</span>');
      el.classList.add('border-emerald-500/30', 'bg-emerald-500/5');
    } else {
      el.innerHTML = '<span class="text-slate-500">Keine aktiven Events</span>';
      el.classList.remove('border-emerald-500/30', 'bg-emerald-500/5');
    }
  } catch {}
}

async function setForcedMap() {
  const map = document.getElementById('forcedMapSelect').value;
  const mins = parseInt(document.getElementById('forcedMapDur').value)||60;
  if (!map) { clearEvent('forcedmap'); return; }
  await apiCall('/api/events/forcedmap','PUT',{mapName:map,durationMinutes:mins});
  showToast('✓ Forced Map aktiv', 'success');
  loadEvents();
}
async function setDoubleLoot() {
  const c = parseFloat(document.getElementById('doubleLootChance').value)||0.5;
  const m = parseInt(document.getElementById('doubleLootDur').value)||30;
  await apiCall('/api/events/doubleloot','PUT',{chance:c,durationMinutes:m});
  showToast('✓ Double Loot aktiv', 'success');
  loadEvents();
}
async function setXPBoost() {
  const mul = parseFloat(document.getElementById('xpBoostMult').value)||2;
  const m   = parseInt(document.getElementById('xpBoostDur').value)||30;
  await apiCall('/api/events/xpboost','PUT',{multiplier:mul,durationMinutes:m});
  showToast('✓ XP Boost aktiv', 'success');
  loadEvents();
}
async function clearEvent(type) {
  await fetch('/api/events/'+type,{method:'DELETE',headers:{'x-session-token':LootGameAPI.getToken()}});
  showToast('Event gestoppt', 'info');
  loadEvents();
}

// ─── Users & Rollen ────────────────────────────────────────────────────────────
