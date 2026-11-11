let liveWS = null;
let liveFeedEvents = [];
let liveReconnectTimer = null;

function updateLiveFeedStatusBadge() {
  const el = document.getElementById('liveFeedStatus');
  if (!el) return;
  if (liveWS && liveWS.readyState === WebSocket.OPEN) {
    el.textContent = 'live';
    el.style.color = 'var(--green)';
  } else if (liveWS && liveWS.readyState === WebSocket.CONNECTING) {
    el.textContent = 'verbinde…';
    el.style.color = '';
  } else {
    el.textContent = 'getrennt, verbinde neu…';
    el.style.color = 'var(--gold)';
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

let liveFeedFilter = 'all';

function setFeedFilter(f) {
  liveFeedFilter = f;
  document.querySelectorAll('#liveFeedFilters [data-feed]').forEach(b => b.classList.toggle('on', b.dataset.feed === f));
  renderLiveFeed();
}

function feedKind(e) {
  if (e.type === 'raid_result') return e.survived ? 'loot' : 'death';
  if (e.type === 'bot_status') return 'bot';
  return 'other';
}

function renderLiveFeed() {
  const el = document.getElementById('liveFeedList');
  if (!el) return; // Übersicht evtl. gerade nicht aktiv/geladen
  const rows = liveFeedEvents.filter(e => feedKind(e) !== 'other' && (liveFeedFilter === 'all' || feedKind(e) === liveFeedFilter));
  if (!rows.length) {
    el.innerHTML = '<div class="feed-empty">' + (liveFeedEvents.length ? 'Keine Einträge für diesen Filter.' : 'Warte auf Aktivität…') + '</div>';
    return;
  }
  const row = (cls, icon, time, html) =>
    `<div class="feed-row"><span class="ibox ${cls}"><svg class="ic sm"><use href="#i-${icon}"/></svg></span><span class="tm">${time}</span><span>${html}</span></div>`;
  el.innerHTML = rows.map(e => {
    const time = new Date(e.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (e.type === 'raid_result') {
      return e.survived
        ? row('gold', 'box', time, `<b>${escHtml(e.username)}</b> hat ${e.itemName ? escHtml(e.itemName) + ' (' + formatLiveValue(e.value) + ')' : formatLiveValue(e.value)} auf ${escHtml(e.map)} gelootet${e.leveledUp ? ' · Level ' + escHtml(e.newLevel) : ''}`)
        : row('pink', 'skull', time, `<b>${escHtml(e.username)}</b> ist auf ${escHtml(e.map)} gestorben`);
    }
    const labels = { tournament: 'Turnier-Modus', maintenance: 'Wartungsmodus', command: 'Command ' + e.cmd, channel: 'Channel ' + e.channel };
    return row('blue', 'gear', time, `${escHtml(labels[e.kind] || e.kind)} ${e.active ? 'aktiviert' : 'deaktiviert'}`);
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
