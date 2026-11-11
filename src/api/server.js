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
const hetznerRoutes     = require('./routes/hetzner');
const adminRoutes    = require('./routes/admin');

const PUBLIC_DIR = path.join(__dirname, '../../public');

// Erlaubte Origins fürs Dashboard (kommagetrennt, z.B. https://lootgamebot.de).
// Ohne gesetzte Env bleibt CORS offen (*), damit nichts ungewollt kaputt geht.
const ALLOWED_ORIGINS = (process.env.DASHBOARD_ORIGIN || '')
    .split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean);

// Content-Security-Policy: zunächst nur im Melde-Modus (Report-Only), damit nichts bricht.
// Mit CSP_ENFORCE=1 in der .env wird sie erzwungen. Die Seiten nutzen Inline-Skripte und
// -Handler sowie CDN-Ressourcen, daher bleibt 'unsafe-inline' vorerst erlaubt; geschützt wird
// trotzdem gegen fremde Skriptquellen, Plugins (object), base-Hijacking, Framing und
// Datenabfluss per fetch/WebSocket an fremde Hosts.
const CSP_ENFORCE = process.env.CSP_ENFORCE === '1';
const CSP_DIRECTIVES = {
    defaultSrc:     ["'self'"],
    scriptSrc:      ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://cdnjs.cloudflare.com'],
    scriptSrcAttr:  ["'unsafe-inline'"],
    styleSrc:       ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
    fontSrc:        ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
    imgSrc:         ["'self'", 'data:', 'blob:', 'https:'],
    connectSrc:     ["'self'", 'https://json.tarkov.dev'],
    workerSrc:      ["'self'"],
    manifestSrc:    ["'self'"],
    objectSrc:      ["'none'"],
    baseUri:        ["'self'"],
    formAction:     ["'self'"],
    frameAncestors: ["'self'"]
};

function createServer() {
    const app = express();

    // Fly.io läuft hinter einem Proxy der X-Forwarded-For setzt — ohne das hier
    // würde express-rate-limit (siehe routes/auth.js) bei jedem Request crashen.
    app.set('trust proxy', 1);

    app.use(helmet({
        contentSecurityPolicy: {
            useDefaults: false,
            reportOnly: !CSP_ENFORCE,
            directives: CSP_DIRECTIVES
        }
    }));

    app.use(express.json({ limit: '10mb' }));

    app.use((req, res, next) => {
        // Mit DASHBOARD_ORIGIN ist CORS auf die genannten Origins beschränkt (gleiche Origin
        // braucht ohnehin kein CORS). Ohne gesetzte Env bleibt es offen wie bisher.
        if (ALLOWED_ORIGINS.length === 0) {
            res.header('Access-Control-Allow-Origin', '*');
        } else {
            res.header('Vary', 'Origin');
            if (req.headers.origin && ALLOWED_ORIGINS.includes(req.headers.origin)) {
                res.header('Access-Control-Allow-Origin', req.headers.origin);
            }
        }
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, x-session-token, x-dashboard-token');
        if (req.method === 'OPTIONS') return res.sendStatus(200);
        next();
    });

    // Static Files — automatisch .html ergänzen falls Datei ohne Endung angefragt wird
    const fs = require('fs');
    app.use((req, res, next) => {
        if (!req.path.includes('.') && !req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
            const htmlFile = require('path').join(PUBLIC_DIR, req.path + '.html');
            if (fs.existsSync(htmlFile)) return res.sendFile(htmlFile);
        }
        next();
    });
    app.use(express.static(PUBLIC_DIR));
    app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));

    // Public Routes
    app.get('/health', (req, res) => {
        let botConnected = false;
        try {
            const { COMMAND_SOURCE } = require('../bot');
            if (COMMAND_SOURCE === 'eventsub') {
                // EventSub-Modus: WebSocket offen ODER isReady (Commands verarbeitet)
                // ODER tmi.js-Verbindung offen (Bot ist im Chat aktiv)
                botConnected = !!(
                    global.eventSubShadow?.isConnected() ||
                    global.eventSubShadow?.isReady() ||
                    global.botInstance?.client?.readyState() === 'OPEN'
                );
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
    app.use('/api/admin/hetzner', sessionAuth, hetznerRoutes);
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