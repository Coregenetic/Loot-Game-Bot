/**
 * Paralleles Twitch-Chat-Modul über EventSub (WebSocket) + Helix API.
 * Läuft komplett UNABHÄNGIG vom bestehenden tmi.js-Bot in src/bot.js —
 * verändert nichts an dessen Verhalten, läuft nur "daneben her".
 *
 * Phase 1 (aktuell): nur beobachten + loggen, sendet NICHTS automatisch.
 * Aktivierung über Env-Var ENABLE_EVENTSUB_SHADOW=true (Default: aus).
 *
 * Quelle für Auth-Anforderungen: https://dev.twitch.tv/docs/chat/chatbot-guide/
 */

const WebSocket = require('ws');
const logger = require('./utils/logger');
const { getAppAccessToken, getUserAccessToken, getClientId, isConfigured } = require('./utils/twitchAuth');

const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';
const HELIX_BASE       = 'https://api.twitch.tv/helix';

const BOT_USER_ID         = process.env.TWITCH_BOT_USER_ID;
const BROADCASTER_USER_ID = process.env.TWITCH_BROADCASTER_USER_ID;

let ws = null;
let sessionId = null;
let reconnecting = false;
let onMessageCallback = null; // wird in Phase 2 mit den echten Command-Handlern verbunden

function isReady() {
    return isConfigured() && !!BOT_USER_ID && !!BROADCASTER_USER_ID;
}


async function deleteExistingSubscriptions() {
    try {
        const token = await getUserAccessToken();
        const res = await fetch(`${HELIX_BASE}/eventsub/subscriptions?type=channel.chat.message`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': getClientId() }
        });
        const data = await res.json();
        const subs = data.data || [];
        for (const sub of subs) {
            try {
                await fetch(`${HELIX_BASE}/eventsub/subscriptions?id=${sub.id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': getClientId() }
                });
                logger.info('EVENTSUB-SHADOW', `Alte Subscription gelöscht: ${sub.id}`);
            } catch {}
        }
    } catch (err) {
        logger.warn('EVENTSUB-SHADOW', 'Konnte alte Subscriptions nicht löschen: ' + err.message);
    }
}

async function createChatMessageSubscription() {
    const token = await getUserAccessToken(); // WICHTIG: App-Token wird hier von Twitch abgelehnt
    const res = await fetch(`${HELIX_BASE}/eventsub/subscriptions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Client-Id': getClientId(),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            type: 'channel.chat.message',
            version: '1',
            condition: {
                broadcaster_user_id: BROADCASTER_USER_ID,
                user_id: BOT_USER_ID
            },
            transport: {
                method: 'websocket',
                session_id: sessionId
            }
        })
    });

    const data = await res.json();
    if (!res.ok) {
        throw new Error(`EventSub-Subscription fehlgeschlagen (${res.status}): ${JSON.stringify(data)}`);
    }
    logger.info('EVENTSUB-SHADOW', `Subscription erstellt: channel.chat.message (id: ${data.data?.[0]?.id})`);
    return data;
}

// ─── Senden (Helix Send Chat Message API) — wird in Phase 1 NICHT automatisch
// aufgerufen, nur als fertige Funktion bereitgestellt zum manuellen Testen. ───
async function sendChatMessage(text) {
    if (!isReady()) throw new Error('EventSub-Shadow ist nicht konfiguriert');
    const token = await getAppAccessToken();

    const res = await fetch(`${HELIX_BASE}/chat/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Client-Id': getClientId(),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            broadcaster_id: BROADCASTER_USER_ID,
            sender_id: BOT_USER_ID,
            message: text
        })
    });

    const data = await res.json();
    if (!res.ok || data.data?.[0]?.is_sent === false) {
        throw new Error(`Senden fehlgeschlagen: ${JSON.stringify(data)}`);
    }
    return data;
}

function handleWebSocketMessage(raw) {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    switch (data.metadata?.message_type) {
        case 'session_welcome':
            sessionId = data.payload.session.id;
            logger.info('EVENTSUB-SHADOW', 'WebSocket verbunden, Session ID erhalten.');
            deleteExistingSubscriptions()
                .then(() => createChatMessageSubscription())
                .catch(err => logger.error('EVENTSUB-SHADOW', err.message));
            break;

        case 'session_reconnect': {
            const newUrl = data.payload.session.reconnect_url;
            logger.warn('EVENTSUB-SHADOW', 'Twitch fordert Reconnect an, wechsle URL...');
            connect(newUrl);
            break;
        }

        case 'notification':
            if (data.metadata.subscription_type === 'channel.chat.message') {
                const event = data.payload.event;

                // Eigene Nachrichten des Bots selbst ignorieren (sonst Endlos-Risiko,
                // genau wie tmi.js' "self"-Check)
                if (event.chatter_user_id === BOT_USER_ID) break;

                // Twitch hängt manchmal unsichtbare Anti-Duplikat-Zeichen an —
                // für saubere Command-Erkennung entfernen
                const cleanText = (event.message.text || '')
                    .replace(/[\u0300-\u036f\u200b-\u200f\ufeff]/g, '')
                    .trim();

                logger.info('EVENTSUB-SHADOW', `<${event.chatter_user_login}> ${cleanText}`);

                if (onMessageCallback) {
                    try { onMessageCallback(event); } catch (err) { logger.error('EVENTSUB-SHADOW', 'Callback-Fehler: ' + err.message); }
                }

                // Nur aktiv Commands verarbeiten, wenn EventSub die gewählte Quelle ist
                const { processCommand, touchOnlineStatus, COMMAND_SOURCE } = require('./bot');
                if (COMMAND_SOURCE === 'eventsub') {
                    const channel = '#' + event.broadcaster_user_login;
                    touchOnlineStatus(event.chatter_user_login, channel);

                    const clientAdapter = {
                        say: async (_ch, msg) => {
                            try { await sendChatMessage(msg); }
                            catch (err) { logger.error('EVENTSUB-SHADOW', 'Senden fehlgeschlagen: ' + err.message); }
                        }
                    };

                    processCommand({
                        client: clientAdapter,
                        channel,
                        username: event.chatter_user_login,
                        message: cleanText,
                        userstate: { username: event.chatter_user_login }
                    }).catch(err => logger.error('EVENTSUB-SHADOW', 'processCommand-Fehler: ' + err.message));
                }
            }
            break;

        case 'session_keepalive':
        case 'revocation':
            break; // nichts zu tun
    }
}

function connect(url = EVENTSUB_WS_URL) {
    if (!isReady()) {
        logger.warn('EVENTSUB-SHADOW', 'Nicht konfiguriert (TWITCH_CLIENT_ID/SECRET/BOT_USER_ID/BROADCASTER_USER_ID fehlen) — wird nicht gestartet.');
        return;
    }

    ws = new WebSocket(url);

    ws.on('open', () => logger.info('EVENTSUB-SHADOW', 'WebSocket-Verbindung geöffnet.'));
    ws.on('message', (raw) => handleWebSocketMessage(raw.toString()));
    ws.on('error', (err) => logger.error('EVENTSUB-SHADOW', 'WebSocket-Fehler: ' + err.message));
    ws.on('close', () => {
        logger.warn('EVENTSUB-SHADOW', 'WebSocket-Verbindung geschlossen.');
        if (!reconnecting) {
            reconnecting = true;
            setTimeout(() => { reconnecting = false; connect(); }, 5000);
        }
    });
}

function start(messageCallback = null) {
    onMessageCallback = messageCallback;
    connect();
}

function stop() {
    if (ws) { ws.removeAllListeners(); ws.close(); ws = null; }
    sessionId = null;
}

function isConnected() {
    return !!(ws && ws.readyState === WebSocket.OPEN);
}

module.exports = { start, stop, sendChatMessage, isReady, isConnected };