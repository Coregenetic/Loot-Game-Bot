let liveWS = null;
let liveFeedEvents = [];
let liveReconnectTimer = null;

function updateLiveFeedStatusBadge() {
  const el = document.getElementById('liveFeedStatus');
  if (!el) return;
  if (liveWS && liveWS.readyState === WebSocket.OPEN) {
    el.textContent = 'live';
    el.className = 'text-[9px] font-mono text-emerald-500';
  } else if (liveWS && liveWS.readyState === WebSocket.CONNECTING) {
    el.textContent = 'verbinde...';
    el.className = 'text-[9px] font-mono text-slate-600';
  } else {
    el.textContent = 'getrennt — verbinde neu...';
    el.className = 'text-[9px] font-mono text-amber-500';
  }
}

function connectLiveWS() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${window.location.host}/ws/admin?token=${encodeURIComponent(LootGameAPI.getToken())}`;
  liveWS = new WebSocket(url);

  liveWS.onopen = () => updateLiveFeedStatusBadge();

  liveWS.onmessage = (event) => {
    try { handleLiveEvent(JSON.parse(event.data)); } catch (err) { console.error('Live-Event Fehler:', err); }
  };

  liveWS.onclose = () => {
    updateLiveFeedStatusBadge();
    clearTimeout(liveReconnectTimer);
    liveReconnectTimer = setTimeout(connectLiveWS, 4000);
  };

  liveWS.onerror = () => { try { liveWS.close(); } catch (_) {} };
}

function formatLiveValue(v) {
  if (!v) return '0 ₽';
  if (v >= 1e6) return (v/1e6).toFixed(1) + 'M ₽';
  if (v >= 1e3) return (v/1e3).toFixed(0) + 'K ₽';
  return v + ' ₽';
}

function renderLiveFeed() {
  const el = document.getElementById('liveFeedList');
  if (!el) return; // Übersicht evtl. gerade nicht aktiv/geladen
  if (!liveFeedEvents.length) {
    el.innerHTML = '<p class="text-xs font-mono text-slate-600">Warte auf Aktivität...</p>';
    return;
  }
  el.innerHTML = liveFeedEvents.map(e => {
    const time = new Date(e.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (e.type === 'raid_result') {
      return e.survived
        ? `<div class="flex items-center justify-between text-xs px-2 py-1.5 rounded-lg bg-emerald-500/5"><span class="text-slate-300">✅ <b class="text-emerald-400">${e.username}</b> hat ${e.itemName ? e.itemName + ' (' + formatLiveValue(e.value) + ')' : formatLiveValue(e.value)} auf ${e.map} gelootet${e.leveledUp ? ' · 🎉 Lvl ' + e.newLevel : ''}</span><span class="text-slate-600 font-mono shrink-0 ml-2">${time}</span></div>`
        : `<div class="flex items-center justify-between text-xs px-2 py-1.5 rounded-lg bg-rose-500/5"><span class="text-slate-300">💀 <b class="text-rose-400">${e.username}</b> ist auf ${e.map} gestorben</span><span class="text-slate-600 font-mono shrink-0 ml-2">${time}</span></div>`;
    }
    if (e.type === 'bot_status') {
      const labels = { tournament: 'Turnier-Modus', maintenance: 'Wartungsmodus', command: 'Command ' + e.cmd, channel: 'Channel ' + e.channel };
      return `<div class="flex items-center justify-between text-xs px-2 py-1.5 rounded-lg bg-blue-500/5"><span class="text-slate-300">⚙️ ${labels[e.kind] || e.kind} ${e.active ? 'aktiviert' : 'deaktiviert'}</span><span class="text-slate-600 font-mono shrink-0 ml-2">${time}</span></div>`;
    }
    return '';
  }).join('');
}

function handleLiveEvent(data) {
  // Feed-Liste pflegen (gecappt, neueste oben)
  liveFeedEvents.unshift(data);
  if (liveFeedEvents.length > 15) liveFeedEvents.length = 15;
  renderLiveFeed();

  // Aktuell offenen Tab passend aktualisieren — bestehende Lade-Funktionen
  // werden einfach erneut aufgerufen, keine doppelte Patch-Logik nötig.
  if (activeTab === 'overview') loadOverview();
  if (activeTab === 'cooldowns') loadCooldowns();
  if (activeTab === 'players' && data.type === 'raid_result' && selectedPlayer?.username === data.username) {
    selectPlayer(data.username);
  } else if (activeTab === 'players' && data.type === 'raid_result') {
    loadPlayers(); // Liste aktualisieren (z.B. Stash-Wert/Online-Status), Detailansicht bleibt unberührt
  }
  if (activeTab === 'server' && data.type === 'bot_status') {
    if (data.kind === 'tournament') loadTournament();
    if (data.kind === 'maintenance') loadMaintenance();
    if (data.kind === 'command') loadCommands_panel();
    if (data.kind === 'channel') loadChannels();
  }
  if (data.type === 'bot_status' && data.kind === 'tournament') updateDashTournamentBtn(data.active);
}

// ─── PWA / Push Notifications ─────────────────────────────────────────────────
