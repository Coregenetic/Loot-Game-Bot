let allPlayers      = [];
let selectedPlayer  = null;

async function loadPlayers() {
  try {
    const players = await apiCall('/api/players');
    allPlayers = players;
    document.getElementById('playerCount').textContent = players.length + ' Gesamt';
    renderPlayerList('');
  } catch (err) { console.error(err); }
}

function filterPlayers(q) { renderPlayerList(q.toLowerCase()); }

function onPlayerSearchInput(value) {
  const clearBtn = document.getElementById('playerSearchClear');
  if (clearBtn) clearBtn.classList.toggle('hidden', !value);
  filterPlayers(value);
}

function clearPlayerSearch() {
  const input = document.getElementById('playerSearchInput');
  if (input) input.value = '';
  document.getElementById('playerSearchClear').classList.add('hidden');
  filterPlayers('');
}

const ITEM_FALLBACK_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNGI1NTYzIiBzdHJva2Utd2lkdGg9IjIiPjxwYXRoIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgZD0iTTIwIDdsLTgtNC04IDRtMTYgMGwtOCA0bTgtNHYxMGwtOCA0bTAtMTBMNCA3bTggNHYxME00IDd2MTBsOCA0Ii8+PC9zdmc+';

function renderPlayerList(q) {
  const filtered = allPlayers.filter(p => p.username.toLowerCase().includes(q));
  const el = document.getElementById('playerList');
  if (!filtered.length) {
    el.innerHTML = '<p class="text-slate-600 text-xs font-mono px-2">Keine Spieler gefunden.</p>';
    return;
  }
  const isActive = (p) => selectedPlayer && selectedPlayer.username === p.username;
  el.innerHTML = filtered.map(p => {
    const statusColor = p.online ? '#10b981' : '#475569';
    const actIcon = p.in_raid
      ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19L19 5M5 5l14 14" />'
      : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l9-9 9 9M5 10v9a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1v-9" />';
    const actLabel = p.in_raid ? 'In Raid' : 'In Hideout';
    return `
    <button onclick="selectPlayer('${p.username}')" id="prow-${p.username}"
      class="player-row w-full text-left pl-2.5 pr-3 py-2 rounded-lg border border-transparent border-l-4 ${isActive(p) ? 'border-l-emerald-500 bg-emerald-500/10' : 'border-l-transparent'} hover:border-slate-700 hover:bg-slate-800/50 transition-all group">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-[11px] font-bold font-mono text-emerald-400 flex-shrink-0">
            ${p.username.slice(0,2).toUpperCase()}
          </div>
          <div class="min-w-0">
            <div class="text-sm font-medium text-slate-200 group-hover:text-white truncate leading-tight">${p.username}</div>
            <div class="text-xs font-mono text-slate-500 tabular-nums leading-tight">Lvl ${p.level||1} · P${p.prestige||0}</div>
          </div>
        </div>
        <div class="text-right flex-shrink-0 ml-2">
          <div class="text-xs font-mono flex items-center justify-end gap-1.5" style="color:${statusColor}">
            <span style="width:6px;height:6px;border-radius:50%;background:${statusColor};display:inline-block;"></span>
            ${p.online ? 'Online' : 'Offline'}
          </div>
          <div class="text-xs font-mono text-slate-500 flex items-center justify-end gap-1 mt-0.5">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">${actIcon}</svg>
            ${actLabel}
          </div>
        </div>
      </div>
    </button>`;
  }).join('');
}

function computeStashPercentile(myValue) {
  if (!allPlayers.length) return null;
  const values = allPlayers.map(p => p.stash_value || 0);
  const below = values.filter(v => v <= myValue).length;
  return Math.round((below / values.length) * 100);
}

function renderRaidHistory(p) {
  const el = document.getElementById('pd-raidbars');
  const history = p.raidHistory || p.raid_history;
  if (!history || !history.length) {
    el.innerHTML = '<p class="text-slate-600 text-xs font-mono">Noch keine Verlaufsdaten — wird ab dem nächsten Raid aufgezeichnet</p>';
    return;
  }
  const last20 = history.slice(-20);
  el.innerHTML = last20.map(survived => `
    <div class="flex-1 rounded-sm ${survived ? 'bg-emerald-500' : 'bg-slate-600'}" style="height:${survived ? '100%' : '40%'}" title="${survived ? 'Überlebt' : 'Gestorben'}"></div>
  `).join('');
}

let curItemCategory = 'all';

function renderInventory() {
  const invEl = document.getElementById('pd-inventory');
  const items = (selectedPlayer && selectedPlayer.inventory) || [];
  document.getElementById('pd-inv-count').textContent = items.length + ' Items';

  if (!items.length) {
    invEl.innerHTML = '<p class="text-slate-600 text-xs font-mono">Inventar leer</p>';
    return;
  }

  let filtered = curItemCategory === 'all' ? items.slice() : items.filter(i => i.category === curItemCategory);
  const sortMode = document.getElementById('pd-sort-select').value;
  if (sortMode === 'price_desc') filtered.sort((a,b) => (b.value*b.count) - (a.value*a.count));
  if (sortMode === 'price_asc')  filtered.sort((a,b) => (a.value*a.count) - (b.value*b.count));
  if (sortMode === 'qty_desc')   filtered.sort((a,b) => b.count - a.count);
  if (sortMode === 'qty_asc')    filtered.sort((a,b) => a.count - b.count);

  if (!filtered.length) {
    invEl.innerHTML = '<p class="text-slate-600 text-xs font-mono">Keine Items in dieser Kategorie</p>';
    return;
  }

  invEl.innerHTML = filtered.map(item => {
    const total = item.value * item.count;
    const iconSrc = item.icon || ITEM_FALLBACK_ICON;
    return `
    <div class="flex items-center justify-between px-3 py-2.5 rounded-xl transition-colors hover:bg-slate-800/30 bg-slate-900/30 border-l-[3px] border-slate-600">
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/[0.04] overflow-hidden">
          <img src="${iconSrc}" alt="" class="w-6 h-6 object-contain" onerror="this.src='${ITEM_FALLBACK_ICON}'">
        </div>
        <div class="min-w-0">
          <span class="text-sm text-slate-200 truncate block">${item.item_name}</span>
          <span class="text-xs font-mono text-slate-500 tabular-nums">${item.count}x</span>
        </div>
      </div>
      <div class="text-right flex-shrink-0 ml-2">
        <div class="text-sm font-mono font-semibold text-amber-400 tabular-nums">${formatVal(total)}</div>
        <div class="text-xs font-mono text-slate-600 tabular-nums">${formatVal(item.value)}/Stk</div>
      </div>
    </div>`;
  }).join('');
}

document.addEventListener('click', (e) => {
  const pill = e.target.closest('.cat-pill');
  if (!pill) return;
  document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('on'));
  pill.classList.add('on');
  curItemCategory = pill.dataset.cat;
  renderInventory();
});

async function selectPlayer(username) {
  // Highlight selected (stronger green left border + brighter bg)
  document.querySelectorAll('.player-row').forEach(r => {
    r.classList.remove('border-l-emerald-500','bg-emerald-500/10');
    r.classList.add('border-l-transparent');
  });
  const row = document.getElementById('prow-' + username);
  if (row) { row.classList.remove('border-l-transparent'); row.classList.add('border-l-emerald-500','bg-emerald-500/10'); }

  try {
    const p = await apiCall('/api/players/' + username);
    selectedPlayer = p;
    curItemCategory = 'all';
    document.querySelectorAll('.cat-pill').forEach(pill => pill.classList.toggle('on', pill.dataset.cat === 'all'));

    // Show detail panel
    document.getElementById('playerEmpty').classList.add('hidden');
    document.getElementById('playerDetail').classList.remove('hidden');

    // Fill header
    document.getElementById('pd-avatar').textContent = username.slice(0,2).toUpperCase();
    document.getElementById('pd-name').textContent   = username;

    // Online-Status + Aktivität
    const statusDot  = document.getElementById('pd-status-dot');
    const statusText = document.getElementById('pd-status-text');
    statusDot.style.background = p.online ? '#10b981' : '#475569';
    statusText.textContent = p.online ? 'Online' : 'Offline';
    statusText.style.color = p.online ? '#10b981' : '#64748b';
    const activityEl = document.getElementById('pd-activity');
    activityEl.textContent = p.inRaid ? 'In Raid' : 'In Hideout';
    activityEl.classList.remove('hidden');

    // Rank
    const ranks = {'1':'Timmy','5':'Wanna-be Camper','10':'BUSCHBEWOHNER','15':'KISTENKRABBLER','20':'Lootstaubsauger','25':'TÜRRAHMEN-TAKTIKER','30':'EXTRACT-LURKER','35':'CHAD IN AUSBILDUNG','40':'ROGUE-KILLER','45':'BOSSJÄGER','50':'TARKOV-TYRANN','60':'TARKOV ELITE','70':'EFT Legende'};
    const lvl = p.level||1;
    let rank = 'Timmy';
    for (const [threshold, name] of Object.entries(ranks).sort((a,b)=>parseInt(a)-parseInt(b))) {
      if (lvl >= parseInt(threshold)) rank = name;
    }
    document.getElementById('pd-rank').textContent = 'Lvl ' + lvl + ' · ' + rank;

    // Badges
    document.getElementById('pd-kappa').classList.toggle('hidden', !p.has_kappa);
    const prestigeEl = document.getElementById('pd-prestige');
    if (p.prestige > 0) { prestigeEl.textContent = '✦ PRESTIGE ' + p.prestige; prestigeEl.classList.remove('hidden'); }
    else prestigeEl.classList.add('hidden');

    // Stats
    document.getElementById('pd-level').textContent   = lvl;
    document.getElementById('pd-xp').textContent      = (p.xp||0).toLocaleString() + ' XP';
    document.getElementById('pd-raids').textContent   = p.raids_total||0;
    document.getElementById('pd-survived').textContent = (p.raids_survived||0) + ' überlebt';
    document.getElementById('pd-died').textContent    = (p.raids_died||0) + ' gestorben';
    const rate = p.raids_total > 0 ? Math.round((p.raids_survived/p.raids_total)*100) : 0;
    const circumference = 2 * Math.PI * 24; // r=24
    const dash = (rate/100) * circumference;
    document.getElementById('pd-survring').setAttribute('stroke-dasharray', dash.toFixed(1) + ' ' + circumference.toFixed(1));
    document.getElementById('pd-survring-text').textContent = rate + '%';
    const myStash = (p.stashValue ?? p.stash_value) || 0;
    document.getElementById('pd-stash').textContent   = formatVal(myStash);
    document.getElementById('pd-items-count').textContent = (p.inventory||[]).length + ' Item-Typen';

    // Percentile (Stash-Wert)
    const pct = computeStashPercentile(myStash);
    document.getElementById('pd-percentile').textContent = pct === null ? '—' : ('Top ' + (100 - pct) + '% (Stash-Wert)');

    // Raid history (braucht p.raidHistory vom Backend — siehe Hinweis im Chat)
    renderRaidHistory(p);

    // Inventory
    renderInventory();
  } catch (err) {
    console.error('Player load error:', err);
  }
}

async function clearUserCD_player() {
  if (!selectedPlayer) return;
  if (!confirm('Cooldown von ' + selectedPlayer.username + ' löschen?')) return;
  try {
    await fetch('/api/admin/cooldowns/' + selectedPlayer.username, {
      method: 'DELETE',
      headers: { 'x-session-token': LootGameAPI.getToken() }
    });
    showToast('CD von ' + selectedPlayer.username + ' gelöscht', 'success');
  } catch (err) { showToast('Fehler: ' + err.message, 'error'); }
}

// ─── Backups ──────────────────────────────────────────────────────────────────
let allItemsCache  = [];
let selectedGiveItem = null;

async function loadAllItemsCache() {
  if (allItemsCache.length) return allItemsCache;
  try {
    const items = await apiCall('/api/items');
    allItemsCache = Object.entries(items).map(([name, data]) => ({
      name, value: data.value || 0
    }));
  } catch {}
  return allItemsCache;
}

async function filterGiveItems(query) {
  await loadAllItemsCache();
  const dropdown = document.getElementById('giveItemDropdown');
  selectedGiveItem = null;

  if (!query || query.length < 1) {
    dropdown.classList.add('hidden');
    return;
  }

  const q = query.toLowerCase();
  const matches = allItemsCache.filter(i => i.name.toLowerCase().includes(q)).slice(0, 30);

  if (!matches.length) {
    dropdown.innerHTML = '<div class="px-3 py-2 text-xs font-mono text-slate-500">Keine Treffer</div>';
    dropdown.classList.remove('hidden');
    return;
  }

  dropdown.innerHTML = matches.map(item => `
    <div class="px-3 py-2 flex items-center justify-between border-b border-slate-800 last:border-0 cursor-pointer hover:bg-slate-800/60 transition-colors"
      onclick="selectGiveItem('${item.name.replace(/'/g,"\\'")}', ${item.value})">
      <span class="text-sm text-white">${item.name}</span>
      <span class="text-xs font-mono text-amber-400">${formatVal(item.value)}</span>
    </div>
  `).join('');
  dropdown.classList.remove('hidden');
}

function selectGiveItem(name, value) {
  selectedGiveItem = { name, value };
  document.getElementById('giveItemSearch').value = name;
  document.getElementById('giveItemDropdown').classList.add('hidden');
  const selEl = document.getElementById('giveItemSelected');
  selEl.textContent = `✓ Ausgewählt: ${name} (${formatVal(value)})`;
  selEl.className = 'text-xs font-mono text-emerald-400 mb-2';
  selEl.classList.remove('hidden');
}

document.addEventListener('click', e => {
  if (!e.target.closest('#giveItemSearch') && !e.target.closest('#giveItemDropdown')) {
    document.getElementById('giveItemDropdown')?.classList.add('hidden');
  }
});

async function giveItemToPlayer() {
  if (!serverPw) return;
  const username = document.getElementById('giveUsername').value.trim();
  const count    = parseInt(document.getElementById('giveCount').value) || 1;
  const resultEl = document.getElementById('giveItemResult');

  if (!username) { resultEl.textContent = '⚠ Bitte Username angeben'; resultEl.className = 'text-xs font-mono text-amber-400'; return; }
  if (!selectedGiveItem) { resultEl.textContent = '⚠ Bitte Item aus der Liste auswählen'; resultEl.className = 'text-xs font-mono text-amber-400'; return; }

  try {
    const res = await fetch('/api/admin/give-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': LootGameAPI.getToken() },
      body: JSON.stringify({ password: serverPw, username, itemName: selectedGiveItem.name, count })
    });
    const data = await res.json();
    if (data.success) {
      resultEl.textContent = `✓ ${count}x "${data.itemName}" an ${username} übergeben`;
      resultEl.className = 'text-xs font-mono text-emerald-400';
      showToast(`✓ Item an ${username} übergeben`, 'success');
      document.getElementById('giveUsername').value = '';
      document.getElementById('giveItemSearch').value = '';
      document.getElementById('giveCount').value = '1';
      document.getElementById('giveItemSelected').classList.add('hidden');
      selectedGiveItem = null;
    } else {
      resultEl.textContent = '✗ ' + (data.error || 'Fehler');
      resultEl.className = 'text-xs font-mono text-rose-400';
    }
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'text-xs font-mono text-rose-400';
  }
}

// ─── Command Control ──────────────────────────────────────────────────────────
