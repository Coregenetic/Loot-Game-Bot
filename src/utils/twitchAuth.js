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

module.exports = { isConfigured, getAppAccessToken, getClientId };
