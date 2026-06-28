const SQUAD_FIELD_LABELS = {
  MinExfilSeconds: 'Min. Raid-Zeit (Sek.)',
  MaxExfilSeconds: 'Max. Raid-Zeit (Sek.)',
  SurvivalChance: 'Überlebenschance (0–1)',
  DoubleLootChance: 'Doppel-Loot-Chance (0–1)',
  KappaDoubleLootBonus: 'Kappa-Bonus (0–1)',
  ValueMultiplier: 'Loot-Wert-Multiplikator'
};

const SQUAD_MEMBER_COLORS = ['#10b981', '#60a5fa', '#f59e0b', '#f472b6', '#a78bfa'];

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

function squadAvatarHTML(m, color) {
  const inner = m.avatarUrl
    ? `<img src="${m.avatarUrl}" alt="" class="absolute inset-0 w-full h-full object-cover" onerror="this.style.display='none'">`
    : (m.displayName || m.username).slice(0,2).toUpperCase();
  return `<div style="width:30px;height:30px;color:${color};" class="rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-[11px] font-semibold overflow-hidden relative shrink-0" >${inner}</div>`;
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

    const memberRows = squad.members.map((m, i) => `
      <div class="flex items-center gap-2.5 ${m.status === 'pending' ? 'opacity-50' : ''}">
        ${squadAvatarHTML(m, SQUAD_MEMBER_COLORS[i % SQUAD_MEMBER_COLORS.length])}
        <div class="min-w-0">
          <div class="text-xs text-slate-200 truncate">${m.displayName}${m.username.toLowerCase() === squad.leaderUsername.toLowerCase() ? ' 👑' : ''}</div>
          <div class="text-[9px] font-mono text-slate-500">Lvl ${m.level}${m.status === 'pending' ? ' · ausstehend' : ''}</div>
        </div>
      </div>`).join('');

    const overrideRows = squadsOverridableFields.map(field => {
      const hasOverride = squad.overrides[field] !== undefined;
      return `
        <div class="flex items-center justify-between">
          <span class="text-xs text-slate-300">${SQUAD_FIELD_LABELS[field]}</span>
          <div class="flex items-center gap-2.5">
            ${hasOverride
              ? `<input type="number" step="0.01" value="${squad.overrides[field]}" id="ov-val-${squad.id}-${field}" class="w-20 bg-slate-950/60 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white text-center focus:border-emerald-500 outline-none">`
              : `<span class="w-20 text-xs font-mono text-slate-600 text-center">Global</span><input type="hidden" id="ov-val-${squad.id}-${field}" value="">`}
            <label class="cmd-toggle">
              <input type="checkbox" ${hasOverride ? 'checked' : ''} id="ov-chk-${squad.id}-${field}" onchange="toggleSquadOverrideInput(${squad.id}, '${field}', this.checked)">
              <span class="track"></span>
              <span class="knob"></span>
            </label>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="glass-card border border-slate-700/50 rounded-2xl overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-800/60 flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
            </div>
            <div>
              <div class="text-sm font-semibold text-white uppercase tracking-wide">${squad.name}</div>
              <div class="text-[10px] font-mono text-slate-500">${accepted.length}/5 Mitglieder${pending.length ? ' · ' + pending.length + ' offen' : ''} · Leader: ${squad.leaderUsername}</div>
            </div>
          </div>
          <button onclick="disbandSquad(${squad.id}, '${squad.name}')" class="text-xs font-mono text-rose-400 hover:text-rose-300 transition-colors px-3 py-1.5 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 shrink-0">Auflösen</button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-[1fr_1.1fr]">
          <div class="p-5 md:border-r border-slate-800/60">
            <div class="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-3">Mitglieder</div>
            <div class="space-y-2.5">${memberRows}</div>
          </div>
          <div class="p-5" style="background:rgba(15,23,42,0.4);">
            <div class="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/></svg>
              Gameplay-Overrides
            </div>
            <div class="space-y-2.5">${overrideRows}</div>
            <button onclick="saveSquadConfig(${squad.id})" class="mt-4 w-full px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 text-xs font-mono transition-colors">Speichern</button>
            <div id="squad-save-msg-${squad.id}" class="text-xs font-mono mt-2 min-h-[14px]"></div>
          </div>
        </div>
      </div>`;
  }).join('');
}

function toggleSquadOverrideInput(squadId, field, checked) {
  const squad = squadsCache.find(s => s.id === squadId);
  if (checked) {
    if (squad.overrides[field] === undefined) squad.overrides[field] = '';
  } else {
    delete squad.overrides[field];
  }
  renderSquads();
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
    const res = await fetch(`/api/admin/squads/${squadId}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-token': LootGameAPI.getToken() },
      body: JSON.stringify(body)
    }).then(r => r.json());
    if (res.error) throw new Error(res.error);
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