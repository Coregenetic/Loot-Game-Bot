const express    = require('express');
const helmet     = require('helmet');
const http       = require('http');
const path       = require('path');
const logger     = require('../utils/logger');
const sessionAuth    = require('./middleware/session');
const { requirePermission } = require('./middleware/permission');
const authRoutes     = require('./routes/auth');
const configRoutes   = require('./routes/config');
const itemsRoutes    = require('./routes/items');
const playersRoutes  = require('./routes/players');
const eventsRoutes   = require('./routes/events');
const messagesRoutes = require('./routes/messages');
const pushRoutes     = require('./routes/push');
const { router: playerAuthRoutes } = require('./routes/playerAuth');
const { router: playerSquadRoutes } = require('./routes/playerSquad');
const adminSquadsRoutes = require('./routes/adminSquads');
const adminRoutes    = require('./routes/admin');

const PUBLIC_DIR = path.join(__dirname, '../../public');

// Erlaubte Origin fürs Dashboard — per Env überschreibbar, sonst alle *.fly.dev
// Domains dieser App (kein offenes Wildcard-CORS mehr).
const ALLOWED_ORIGIN = process.env.DASHBOARD_ORIGIN || null;

function createServer() {
    const app = express();

    // Fly.io läuft hinter einem Proxy der X-Forwarded-For setzt — ohne das hier
    // würde express-rate-limit (siehe routes/auth.js) bei jedem Request crashen.
    app.set('trust proxy', 1);

    app.use(helmet({
        contentSecurityPolicy: false // eigenes CSP würde Tailwind-CDN/Inline-Scripts blockieren
    }));

    app.use(express.json({ limit: '10mb' }));

    app.use((req, res, next) => {
        // Setze DASHBOARD_ORIGIN (z.B. https://lootgamebot.fly.dev) um CORS auf
        // eure eigene Domain einzuschränken. Ohne gesetzte Env bleibt es offen wie
        // bisher, damit nichts ungewollt kaputt geht.
        res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN || '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, x-session-token, x-dashboard-token');
        if (req.method === 'OPTIONS') return res.sendStatus(200);
        next();
    });

    // Static Files
    app.use(express.static(PUBLIC_DIR));
    app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));

    // Public Routes
    app.get('/health', (req, res) => {
        let botConnected = false;
        try {
            const { COMMAND_SOURCE } = require('../bot');
            if (COMMAND_SOURCE === 'eventsub') {
                botConnected = !!global.eventSubShadow?.isConnected();
            } else {
                botConnected = global.botInstance?.client?.readyState() === 'OPEN';
            }
        } catch (_) {}
        res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now(), botConnected });
    });

    app.use('/api/auth', authRoutes);

    // Overlay (kein Auth)
    app.get('/overlay/leaderboard', (req, res) => {
        try {
            const { getLatestLeaderboardData } = require('../commands/leaderboard');
            const data = getLatestLeaderboardData();
            if (!data) return res.status(404).json({ error: 'Noch kein !toplooter getriggert' });
            res.json(data);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/overlay/level/latest', (req, res) => {
        try {
            const { getLatestLevelData } = require('../commands/level');
            const data = getLatestLevelData();
            if (!data) return res.status(404).json({ error: 'Noch kein !lvl getriggert' });
            res.json(data);
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

    // Öffentlicher Events-Endpunkt für Overlays
    app.get('/api/events', (req, res) => {
        try {
            const { getActiveEvents } = require('../db/config');
            res.json(getActiveEvents());
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // Kappa-Übersicht (öffentlich, Token-geschützt)
    app.get('/api/kappa/:token', (req, res) => {
        try {
            const { validateKappaToken } = require('../utils/kappaTokens');
            const username = validateKappaToken(req.params.token);
            if (!username) return res.status(401).json({ error: 'Link abgelaufen oder ungültig. Tippe !kappa erneut im Chat.' });

            const { getPlayer, getInventory } = require('../db/players');
            const { getKappaItems }           = require('../db/items');

            const player = getPlayer(username);
            if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden' });

            const kappaItems = getKappaItems();
            const inventory  = getInventory(player.id);
            const invMap     = new Map(inventory.map(i => [i.item_name.toLowerCase(), i]));

            const items = kappaItems.map(item => {
                const name    = item.text || item.name;
                const invItem = invMap.get(name.toLowerCase());
                return {
                    name,
                    have:  !!(invItem && invItem.count > 0),
                    count: invItem ? invItem.count : 0,
                    value: item.value || 0
                };
            });

            const found = items.filter(i => i.have).length;

            res.json({
                username:  player.username,
                hasKappa:  player.has_kappa === 1,
                found,
                total:     items.length,
                items
            });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // Log-Buffer
    app.get('/api/logs', sessionAuth, requirePermission('logs:view'), (req, res) => {
        res.json(logger.getBuffer());
    });

    // Protected Routes
    app.use('/api/config',   sessionAuth, configRoutes);
    app.use('/api/items',    sessionAuth, itemsRoutes);
    app.use('/api/players',  sessionAuth, playersRoutes);
    app.use('/api/events',   sessionAuth, eventsRoutes);
    app.use('/api/messages', sessionAuth, messagesRoutes);
    app.use('/api/push',     pushRoutes); // Auth wird pro Route innen gehandhabt (vapid-key ist öffentlich)
    app.use('/api/player-auth', playerAuthRoutes); // Eigenes, von Dashboard komplett getrenntes Auth-System
    app.use('/api/squad', playerSquadRoutes); // Nutzt playerSessionAuth intern, keine extra Middleware hier
    app.use('/api/admin/squads', sessionAuth, adminSquadsRoutes);
    app.use('/api/admin',    sessionAuth, adminRoutes);

    return app;
}

function startServer() {
    const app  = createServer();
    const port = process.env.PORT || 3000;
    const httpServer = app.listen(port, '0.0.0.0', () => {
        logger.info('API', `Server läuft auf http://0.0.0.0:${port}`);
    });

    const wsHub = require('../utils/wsHub');
    wsHub.attach(httpServer);

    return { httpServer, app };
}

module.exports = { createServer, startServer };