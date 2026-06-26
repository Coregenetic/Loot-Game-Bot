/**
 * Verwaltet den App Access Token für die Twitch Helix API / EventSub.
 * App Access Tokens brauchen keinen Login-Flow — werden per Client-ID +
 * Client-Secret direkt vom Server angefragt (Client Credentials Grant).
 * Halten ca. 60 Tage, werden hier automatisch erneuert wenn nötig.
 */

const CLIENT_ID     = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

let cachedToken = null;
let expiresAt   = 0;

function isConfigured() {
    return !!(CLIENT_ID && CLIENT_SECRET);
}

async function getAppAccessToken() {
    if (!isConfigured()) {
        throw new Error('TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET nicht gesetzt');
    }

    const now = Math.floor(Date.now() / 1000);
    if (cachedToken && expiresAt - now > 300) {
        return cachedToken; // noch mind. 5 Minuten gültig
    }

    const res = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'client_credentials'
        })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Twitch App-Token-Anfrage fehlgeschlagen (${res.status}): ${text}`);
    }

    const data = await res.json();
    cachedToken = data.access_token;
    expiresAt   = now + data.expires_in;
    return cachedToken;
}

function getClientId() {
    return CLIENT_ID;
}

// ─── User Access Token (für die EventSub-Subscription-Erstellung) ────────────
// WebSocket-EventSub-Subscriptions MÜSSEN mit einem User Access Token erstellt
// werden — ein App Access Token wird dafür von Twitch abgelehnt ("invalid
// transport and auth combination"). Senden von Nachrichten läuft weiterhin
// über den App-Token (anderer Endpunkt, andere Regel).
let cachedUserToken     = null;
let userTokenExpiresAt  = 0;
let currentRefreshToken = process.env.TWITCH_BOT_REFRESH_TOKEN;

async function getUserAccessToken() {
    if (!CLIENT_ID || !CLIENT_SECRET || !currentRefreshToken) {
        throw new Error('TWITCH_BOT_REFRESH_TOKEN nicht gesetzt');
    }

    const now = Math.floor(Date.now() / 1000);
    if (cachedUserToken && userTokenExpiresAt - now > 300) {
        return cachedUserToken;
    }

    const res = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: currentRefreshToken,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET
        })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`User-Token-Refresh fehlgeschlagen (${res.status}): ${text}`);
    }

    const data = await res.json();
    cachedUserToken    = data.access_token;
    userTokenExpiresAt = now + data.expires_in;

    // Twitch rotiert den Refresh-Token bei jedem Refresh — der alte wird danach
    // ungültig. Läuft der Prozess neu hoch BEVOR das Fly-Secret aktualisiert
    // wurde, schlägt der nächste Refresh fehl (wird geloggt, aber nicht fatal
    // für den restlichen Bot — dieses Modul ist ja bewusst isoliert).
    if (data.refresh_token && data.refresh_token !== currentRefreshToken) {
        currentRefreshToken = data.refresh_token;
        console.warn('[TWITCH-AUTH] Refresh-Token hat sich geändert! Bitte TWITCH_BOT_REFRESH_TOKEN als Fly-Secret aktualisieren:');
        console.warn('[TWITCH-AUTH] Neuer Refresh-Token: ' + data.refresh_token);
    }

    return cachedUserToken;
}

module.exports = { isConfigured, getAppAccessToken, getUserAccessToken, getClientId };