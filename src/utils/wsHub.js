/**
 * Live-Update-Kanal fürs Admin Panel — komplett getrennt von der
 * EventSub-Twitch-Verbindung (bot-eventsub.js). Hier verbindet sich das
 * Dashboard selbst (im Browser) zu UNSEREM Server, nicht zu Twitch.
 * Bei relevanten Ereignissen (Raid aufgelöst, Bot-Status geändert, etc.)
 * wird an alle verbundenen Dashboards gebroadcastet — die vorhandenen
 * Lade-Funktionen pro Tab werden dann clientseitig einfach erneut
 * angestoßen, statt für jede Zahl eine eigene Patch-Logik zu pflegen.
 */
const WebSocket = require('ws');
const logger = require('./logger');

let wss = null;
const clients = new Set();

function attach(httpServer) {
    wss = new WebSocket.Server({ server: httpServer, path: '/ws/admin' });

    wss.on('connection', (ws, req) => {
        try {
            const url = new URL(req.url, 'http://localhost');
            const token = url.searchParams.get('token');
            const { validateSession } = require('../db/users');
            const session = validateSession(token);
            if (!session) {
                ws.close(4001, 'Unauthorized');
                return;
            }
            ws.username = session.username;
            clients.add(ws);
            logger.info('WS-HUB', `Dashboard verbunden: ${session.username} (${clients.size} aktiv)`);

            ws.on('close', () => {
                clients.delete(ws);
                logger.info('WS-HUB', `Dashboard getrennt: ${session.username} (${clients.size} aktiv)`);
            });
            ws.on('error', () => clients.delete(ws));
        } catch (err) {
            logger.error('WS-HUB', 'Verbindungsfehler: ' + err.message);
            ws.close(1011, 'Server error');
        }
    });

    logger.info('WS-HUB', 'Live-Update-Server bereit unter /ws/admin');
}

function broadcast(event) {
    if (!clients.size) return;
    const payload = JSON.stringify({ ...event, ts: Date.now() });
    for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(payload); } catch (_) {}
        }
    }
}

module.exports = { attach, broadcast };
