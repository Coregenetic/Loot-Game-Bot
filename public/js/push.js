function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.error('Service Worker Registrierung fehlgeschlagen:', err);
    return null;
  }
}

async function updatePushBellState() {
  const dot = document.getElementById('pushDot');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { dot.classList.add('hidden'); return; }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    dot.classList.toggle('hidden', !sub);
  } catch { dot.classList.add('hidden'); }
}

async function togglePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    showToast('Push-Benachrichtigungen werden von diesem Browser nicht unterstützt', 'error');
    return;
  }

  const reg = await registerServiceWorker();
  if (!reg) { showToast('Service Worker konnte nicht registriert werden', 'error'); return; }

  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    // Abmelden
    try {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': LootGameAPI.getToken() },
        body: JSON.stringify({ endpoint: existing.endpoint })
      });
      await existing.unsubscribe();
      showToast('🔕 Push-Benachrichtigungen deaktiviert', 'info');
    } catch (err) { showToast('Fehler: ' + err.message, 'error'); }
    updatePushBellState();
    return;
  }

  // Anmelden
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('Berechtigung für Benachrichtigungen wurde nicht erteilt', 'warning');
      return;
    }

    const { key, configured } = await fetch('/api/push/vapid-public-key').then(r => r.json());
    if (!configured) {
      showToast('Push ist serverseitig noch nicht konfiguriert (VAPID-Keys fehlen)', 'error');
      return;
    }

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key)
    });

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': LootGameAPI.getToken() },
      body: JSON.stringify(subscription.toJSON())
    });

    showToast('🔔 Push-Benachrichtigungen aktiviert', 'success');
  } catch (err) {
    showToast('Fehler beim Aktivieren: ' + err.message, 'error');
  }
  updatePushBellState();
}

