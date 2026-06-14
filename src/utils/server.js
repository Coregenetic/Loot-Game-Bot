const express    = require('express');
const http       = require('http');
const path       = require('path');
const logger     = require('../utils/logger');
const sessionAuth    = require('./middleware/session');
const authRoutes     = require('./routes/auth');
const configRoutes   = require('./routes/config');
const itemsRoutes    = require('./routes/items');
const playersRoutes  = require('./routes/players');
const eventsRoutes   = require('./routes/events');
const messagesRoutes = require('./routes/messages');
const adminRoutes    = require('./routes/admin');
const { createWebSocketServer } = require('./websocket');

const PUBLIC_DIR = path.join(__dirname, '../../public');

function createServer() {
    const app = express();

    app.use(express.json({ limit: '10mb' }));

    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, x-session-token, x-dashboard-token');
        if (req.method === 'OPTIONS') return res.sendStatus(200);
        next();
    });

    // Static Files
    app.use(express.static(PUBLIC_DIR));
    app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'Control_Center.html')));

    // Public Routes
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
    });

    app.use('/api/auth', authRoutes);

    // Overlay (kein Auth)
    app.get('/overlay/leaderboard', (req, res) => {
        try {
            const { getLeaderboard } = require('../db/players');
            const { formatShort }    = require('../utils/format');
            const players = getLeaderboard(5);
            res.json({ timestamp: Date.now(), players: players.map(p => ({
                name: p.username, value: p.stash_value,
                formattedValue: formatShort(p.stash_value),
                level: p.level, prestige: p.prestige, hasKappa: p.has_kappa === 1
            }))});
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/overlay/level/:username', (req, res) => {
        try {
            const { getPlayer, getStashValue } = require('../db/players');
            const { getLeveling }              = require('../db/config');
            const { calcXPForLevel, getRankName } = require('../utils/format');
            const player = getPlayer(req.params.username);
            if (!player) return res.status(404).json({ error: 'Player not found' });
            const leveling = getLeveling();
            const xpForCur = calcXPForLevel(player.level, leveling);
            const xpForNxt = calcXPForLevel(player.level + 1, leveling);
            const xpInLvl  = Math.max(0, player.xp - xpForCur);
            const xpNeeded = Math.max(1, xpForNxt - xpForCur);
            res.json({
                timestamp: Date.now(), user: player.username,
                level: player.level, rank: getRankName(player.level, leveling.Ranks),
                prestige: player.prestige, hasKappa: player.has_kappa === 1,
                xp: xpInLvl, xpNeeded, progress: Math.round((xpInLvl / xpNeeded) * 100),
                stashValue: getStashValue(player.id),
                raidsTotal: player.raids_total, raidsSurvived: player.raids_survived, raidsDied: player.raids_died
            });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // Log-Buffer Endpunkt
    app.get('/api/logs', sessionAuth, (req, res) => {
        res.json(logger.getBuffer());
    });

    // Protected Routes
    app.use('/api/config',   sessionAuth, configRoutes);
    app.use('/api/items',    sessionAuth, itemsRoutes);
    app.use('/api/players',  sessionAuth, playersRoutes);
    app.use('/api/events',   sessionAuth, eventsRoutes);
    app.use('/api/messages', sessionAuth, messagesRoutes);
    app.use('/api/admin',    sessionAuth, adminRoutes);

    return app;
}

function startServer() {
    const app    = createServer();
    const server = http.createServer(app);
    const port   = process.env.PORT || 3000;

    // WebSocket
    createWebSocketServer(server);

    server.listen(port, '0.0.0.0', () => {
        logger.info('API', `Server läuft auf http://0.0.0.0:${port}`);
    });

    return { httpServer: server, app };
}

module.exports = { createServer, startServer };
