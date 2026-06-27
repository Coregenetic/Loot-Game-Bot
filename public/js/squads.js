const SQUAD_FIELD_LABELS = {
  MinExfilSeconds: 'Min. Raid-Zeit (Sek.)',
  MaxExfilSeconds: 'Max. Raid-Zeit (Sek.)',
  SurvivalChance: 'Überlebenschance (0–1)',
  DoubleLootChance: 'Doppel-Loot-Chance (0–1)',
  KappaDoubleLootBonus: 'Kappa-Bonus (0–1)',
  ValueMultiplier: 'Loot-Wert-Multiplikator'
};

let squadsCache = [];
let squadsOverridableFields = [];

async function loadSquads() {
  try {
    const data = await apiCall('/api/admin/squads');
    squadsCache = data.squads;
    squadsOverridableFields = data.overridableFields;
    renderSquads();
  } catch (err) {
    document.getElementById('squadsList').innerHTML = '<p class="text-xs font-mono text-rose-400">Fehler: ' + err.message + '</p>';
  }
}

function squadAvatarHTML(m) {
  const inner = m.avatarUrl
    ? `<img src="${m.avatarUrl}" alt="" class="absolute inset-0 w-full h-full object-cover" onerror="this.style.display='none'">`
    : (m.displayName || m.username).slice(0,2).toUpperCase();
  return `<div class="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-semibold text-slate-300 overflow-hidden relative shrink-0" style="font-family:'JetBrains Mono',monospace;">${inner}</div>`;
}

function renderSquads() {
  const el = document.getElementById('squadsList');
  if (!squadsCache.length) {
    el.innerHTML = '<p class="text-xs font-mono text-slate-500">Noch keine Squads vorhanden.</p>';
    return;
  }

  el.innerHTML = squadsCache.map(squad => {
    const accepted = squad.members.filter(m => m.status === 'accepted');
    const pending  = squad.members.filter(m => m.status === 'pending');

    const memberRows = squad.members.map(m => `
      <div class="flex items-center gap-2.5 ${m.status === 'pending' ? 'opacity-50' : ''}">
        ${squadAvatarHTML(m)}
        <div>
          <div class="text-xs text-slate-200">${m.displayName}${m.username.toLowerCase() === squad.leaderUsername.toLowerCase() ? ' 👑' : ''}</div>
          <div class="text-[9px] font-mono text-slate-500">Lvl ${m.level}${m.status === 'pending' ? ' · ausstehend' : ''}</div>
        </div>
      </div>`).join('');

    const overrideRows = squadsOverridableFields.map(field => {
      const hasOverride = squad.overrides[field] !== undefined;
      return `
        <div class="flex items-center gap-2.5">
          <input type="checkbox" ${hasOverride ? 'checked' : ''} onchange="toggleSquadOverrideInput(${squad.id}, '${field}', this.checked)" id="ov-chk-${squad.id}-${field}" class="w-3.5 h-3.5 rounded border-slate-700 bg-slate-900 text-emerald-500">
          <label for="ov-chk-${squad.id}-${field}" class="text-xs text-slate-400 flex-1">${SQUAD_FIELD_LABELS[field]}</label>
          <input type="number" step="0.01" value="${hasOverride ? squad.overrides[field] : ''}" placeholder="Global" ${hasOverride ? '' : 'disabled'}
            id="ov-val-${squad.id}-${field}" class="w-24 bg-slate-900/50 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white disabled:opacity-40 disabled:cursor-not-allowed focus:border-emerald-500 outline-none">
        </div>`;
    }).join('');

    return `
      <div class="glass-card border border-slate-700/50 rounded-2xl overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-800/60 flex items-center justify-between">
          <div>
            <div class="text-sm font-semibold text-white">${squad.name}</div>
            <div class="text-[10px] font-mono text-slate-500">${accepted.length}/5 Mitglieder${pending.length ? ' · ' + pending.length + ' offen' : ''} · Leader: ${squad.leaderUsername}</div>
          </div>
          <button onclick="disbandSquad(${squad.id}, '${squad.name}')" class="text-xs font-mono text-rose-400 hover:text-rose-300 transition-colors px-3 py-1.5 rounded-lg border border-rose-500/30 hover:bg-rose-500/10">Auflösen</button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-5 p-5">
          <div>
            <div class="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-3">Mitglieder</div>
            <div class="space-y-2.5">${memberRows}</div>
          </div>
          <div>
            <div class="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-3">Gameplay-Overrides</div>
            <div class="space-y-2">${overrideRows}</div>
            <button onclick="saveSquadConfig(${squad.id})" class="mt-3 w-full px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 text-xs font-mono transition-colors">Speichern</button>
            <div id="squad-save-msg-${squad.id}" class="text-xs font-mono mt-2 min-h-[14px]"></div>
          </div>
        </div>
      </div>`;
  }).join('');
}

function toggleSquadOverrideInput(squadId, field, checked) {
  const input = document.getElementById(`ov-val-${squadId}-${field}`);
  input.disabled = !checked;
  if (checked && !input.value) input.value = '';
  if (!checked) input.value = '';
}

async function saveSquadConfig(squadId) {
  const body = {};
  for (const field of squadsOverridableFields) {
    const checkbox = document.getElementById(`ov-chk-${squadId}-${field}`);
    const input = document.getElementById(`ov-val-${squadId}-${field}`);
    if (checkbox.checked && input.value !== '') body[field] = input.value;
  }

  const msgEl = document.getElementById(`squad-save-msg-${squadId}`);
  try {
    await fetch(`/api/admin/squads/${squadId}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-token': LootGameAPI.getToken() },
      body: JSON.stringify(body)
    }).then(r => r.json()).then(d => { if (d.error) throw new Error(d.error); });
    msgEl.textContent = '✓ Gespeichert';
    msgEl.className = 'text-xs font-mono mt-2 min-h-[14px] text-emerald-400';
    loadSquads();
  } catch (err) {
    msgEl.textContent = '✗ ' + err.message;
    msgEl.className = 'text-xs font-mono mt-2 min-h-[14px] text-rose-400';
  }
}

function disbandSquad(squadId, name) {
  showConfirm('Squad auflösen?', `"${name}" wird aufgelöst, alle Mitgliedschaften gehen verloren. Das kann nicht rückgängig gemacht werden.`, async () => {
    try {
      await fetch(`/api/admin/squads/${squadId}`, { method: 'DELETE', headers: { 'x-session-token': LootGameAPI.getToken() } });
      showToast('✓ Squad aufgelöst', 'success');
      loadSquads();
    } catch (err) {
      showToast('✗ ' + err.message, 'error');
    }
  });
}
