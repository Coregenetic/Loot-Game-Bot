const express    = require('express');
const path       = require('path');
const auth       = require('./middleware/auth');
const configRoutes  = require('./routes/config');
const itemsRoutes   = require('./routes/items');
const playersRoutes = require('./routes/players');
const eventsRoutes  = require('./routes/events');

function createServer() {
    const app = express();

    // ─── Middleware ───────────────────────────────────────────────────────────
    app.use(express.json({ limit: '5mb' }));

    // CORS — erlaubt Game Center lokal und deployed
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, x-dashboard-token');
        if (req.method === 'OPTIONS') return res.sendStatus(200);
        next();
    });

    // ─── Public Routes (kein Auth) ────────────────────────────────────────────

    // Health Check
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
    });

    // Auth prüfen
    app.post('/api/auth', (req, res) => {
        const token = req.body.password || req.body.token;
        if (token === process.env.DASHBOARD_PASSWORD) {
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: 'Wrong password' });
        }
    });

    // Overlay-Daten — kein Auth nötig (werden von OBS gelesen)
    app.get('/overlay/leaderboard', (req, res) => {
        try {
            const { getLeaderboard } = require('../db/players');
            const { formatShort }    = require('../utils/format');
            const players = getLeaderboard(5);
            res.json({
                timestamp: Date.now(),
                players: players.map(p => ({
                    name:           p.username,
                    value:          p.stash_value,
                    formattedValue: formatShort(p.stash_value),
                    level:          p.level,
                    prestige:       p.prestige,
                    hasKappa:       p.has_kappa === 1
                }))
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/overlay/level/:username', (req, res) => {
        try {
            const { getPlayer, getStashValue } = require('../db/players');
            const { getLeveling }              = require('../db/config');
            const { calcXPForLevel, getRankName, formatCurrency } = require('../utils/format');

            const player   = getPlayer(req.params.username);
            if (!player) return res.status(404).json({ error: 'Player not found' });

            const leveling = getLeveling();
            const xpForCur = calcXPForLevel(player.level, leveling);
            const xpForNxt = calcXPForLevel(player.level + 1, leveling);
            const xpInLvl  = Math.max(0, player.xp - xpForCur);
            const xpNeeded = Math.max(1, xpForNxt - xpForCur);

            res.json({
                timestamp:    Date.now(),
                user:         player.username,
                level:        player.level,
                rank:         getRankName(player.level, leveling.Ranks),
                prestige:     player.prestige,
                hasKappa:     player.has_kappa === 1,
                xp:           xpInLvl,
                xpNeeded,
                progress:     Math.round((xpInLvl / xpNeeded) * 100),
                stashValue:   getStashValue(player.id),
                raidsTotal:   player.raids_total,
                raidsSurvived:player.raids_survived,
                raidsDied:    player.raids_died
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ─── Protected Routes (Auth required) ────────────────────────────────────
    app.use('/api/config',  auth, configRoutes);
    app.use('/api/items',   auth, itemsRoutes);
    app.use('/api/players', auth, playersRoutes);
    app.use('/api/events',  auth, eventsRoutes);

    return app;
}

function startServer() {
    const app  = createServer();
    const port = process.env.PORT || 3000;

    app.listen(port, () => {
        console.log(`[API] Server läuft auf http://localhost:${port}`);
        console.log(`[API] Health: http://localhost:${port}/health`);
    });

    return app;
}

module.exports = { createServer, startServer };
