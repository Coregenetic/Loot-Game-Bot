const { WebSocketServer } = require('ws');
const { validateSession }  = require('../db/users');
const logger               = require('../utils/logger');

let wss = null;

function createWebSocketServer(server) {
    wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws, req) => {
        // Auth über Query-Parameter
        const url   = new URL(req.url, 'http://localhost');
        const token = url.searchParams.get('token');
        const session = validateSession(token);

        if (!session) {
            ws.close(4001, 'Unauthorized');
            return;
        }

        logger.info('WS', `Client verbunden: ${session.username}`);

        // Letzten 50 Logs senden beim Connect
        const buffer = logger.getBuffer().slice(-50);
        ws.send(JSON.stringify({ type: 'buffer', data: buffer }));

        ws.on('close', () => {
            logger.info('WS', `Client getrennt: ${session.username}`);
        });

        ws.on('error', () => {});
    });

    // Logger mit Broadcast verbinden
    logger.setWsBroadcast((msg) => {
        if (!wss) return;
        for (const client of wss.clients) {
            if (client.readyState === 1) { // OPEN
                try { client.send(msg); } catch {}
            }
        }
    });

    logger.info('WS', 'WebSocket Server gestartet auf /ws');
    return wss;
}

module.exports = { createWebSocketServer };
