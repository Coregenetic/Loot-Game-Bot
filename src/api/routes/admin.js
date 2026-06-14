const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const { run, all, get, saveDb } = require('../../db/schema');
const { invalidateAll } = require('../../db/cache');

// ─── Fly.io Machine Info ──────────────────────────────────────────────────────

router.get('/machine', (req, res) => {
    try {
        // Fly.io setzt diese Env-Vars automatisch in der laufenden Machine
        res.json({
            id:          process.env.FLY_MACHINE_ID     || 'e2862de0b33238',
            app:         process.env.FLY_APP_NAME       || 'lootgamebot',
            region:      process.env.FLY_REGION         || 'fra',
            image:       process.env.FLY_IMAGE_REF      || null,
            alloc_id:    process.env.FLY_ALLOC_ID       || null,
            version:     process.env.FLY_APP_VERSION    || null,
            memory_mb:   process.env.FLY_VM_MEMORY_MB   || null,
            public_ip:   process.env.FLY_PUBLIC_IP      || null,
            private_ip:  process.env.FLY_PRIVATE_IP     || null,
            // Node.js Prozess-Infos
            uptime:      Math.floor(process.uptime()),
            memory:      process.memoryUsage(),
            node:        process.version,
            pid:         process.pid,
            platform:    process.platform,
            // Bot Status
            channel:     process.env.TWITCH_CHANNEL || '—',
            env:         process.env.NODE_ENV || 'production'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Command Control ──────────────────────────────────────────────────────────

// ─── Command Control ──────────────────────────────────────────────────────────

// GET /api/admin/commands — Status aller Commands
router.get('/commands', (req, res) => {
    try {
        const bot = global.botInstance;
        if (!bot) return res.status(503).json({ error: 'Bot nicht bereit' });
        res.json(bot.getCommandStatus());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/commands/:cmd — Command ein/aus
router.post('/commands/:cmd', (req, res) => {
    try {
        const { password } = req.body;
        if (password !== SERVER_CONTROL_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });

        const bot = global.botInstance;
        if (!bot) return res.status(503).json({ error: 'Bot nicht bereit' });

        const cmd    = req.params.cmd.toLowerCase();
        const active = req.body.active !== false;
        bot.setCommandActive(cmd, active);

        res.json({ success: true, cmd, active });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Channel Control ──────────────────────────────────────────────────────────

// GET /api/admin/channels — Status aller Channels
router.get('/channels', (req, res) => {
    try {
        const bot = global.botInstance;
        if (!bot) return res.status(503).json({ error: 'Bot nicht bereit' });
        res.json(bot.getChannelStatus());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/channels/:channel — Channel ein/aus
router.post('/channels/:channel', (req, res) => {
    try {
        const { password } = req.body;
        if (password !== SERVER_CONTROL_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });

        const bot = global.botInstance;
        if (!bot) return res.status(503).json({ error: 'Bot nicht bereit' });

        const channel = req.params.channel.toLowerCase();
        const active  = req.body.active !== false; // default true
        bot.setChannelActive(channel, active);

        res.json({ success: true, channel, active });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Server Control Passwort ──────────────────────────────────────────────────
const SERVER_CONTROL_PASSWORD = process.env.SERVER_CONTROL_PASSWORD || 'admin2025';

router.post('/server/auth', (req, res) => {
    const { password } = req.body;
    if (password === SERVER_CONTROL_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, error: 'Falsches Passwort' });
    }
});

// ─── Bot reconnect ────────────────────────────────────────────────────────────
router.post('/server/reconnect', (req, res) => {
    const { password } = req.body;
    if (password !== SERVER_CONTROL_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });

    try {
        // Graceful reconnect via process signal
        setTimeout(() => {
            process.emit('SIGTERM');
        }, 500);
        res.json({ success: true, message: 'Bot wird neu gestartet...' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Cache leeren ─────────────────────────────────────────────────────────────
router.post('/server/cache', (req, res) => {
    const { password } = req.body;
    if (password !== SERVER_CONTROL_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });

    try {
        invalidateAll();
        res.json({ success: true, message: 'Cache geleert — alle Daten werden neu geladen' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── DB Snapshot ──────────────────────────────────────────────────────────────
router.post('/server/snapshot', (req, res) => {
    const { password } = req.body;
    if (password !== SERVER_CONTROL_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });

    try {
        saveDb();
        res.json({ success: true, message: 'DB Snapshot gespeichert' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Server Info ──────────────────────────────────────────────────────────────
router.get('/server/info', (req, res) => {
    res.json({
        uptime:   process.uptime(),
        memory:   process.memoryUsage(),
        node:     process.version,
        env:      process.env.NODE_ENV,
        channel:  process.env.TWITCH_CHANNEL
    });
});

// ─── Cooldowns ────────────────────────────────────────────────────────────────
router.delete('/cooldowns', (req, res) => {
    try {
        run('DELETE FROM cooldowns');
        res.json({ success: true, message: 'Alle Cooldowns gelöscht' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/cooldowns/:username', (req, res) => {
    try {
        const player = get('SELECT id FROM players WHERE lower(username) = lower(?)', [req.params.username]);
        if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden' });
        run('DELETE FROM cooldowns WHERE player_id = ?', [player.id]);
        res.json({ success: true, username: req.params.username });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Cache ────────────────────────────────────────────────────────────────────
router.post('/cache/clear', (req, res) => {
    try {
        invalidateAll();
        res.json({ success: true, message: 'Cache geleert' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Dashboard Users ──────────────────────────────────────────────────────────
router.get('/users', (req, res) => {
    try {
        const users = all('SELECT id, username, created_at, updated_at FROM dashboard_users');
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/users', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username und Passwort erforderlich' });
        if (password.length < 6) return res.status(400).json({ error: 'Passwort muss min. 6 Zeichen haben' });

        const existing = get('SELECT id FROM dashboard_users WHERE lower(username) = lower(?)', [username]);
        if (existing) return res.status(409).json({ error: 'User existiert bereits' });

        const hash = await bcrypt.hash(password, 10);
        run('INSERT INTO dashboard_users (username, password_hash) VALUES (?, ?)', [username.toLowerCase(), hash]);
        saveDb();
        res.json({ success: true, username: username.toLowerCase() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/users/:username', (req, res) => {
    try {
        if (req.session.username === req.params.username.toLowerCase()) {
            return res.status(400).json({ error: 'Du kannst dich nicht selbst löschen' });
        }
        run('DELETE FROM dashboard_users WHERE lower(username) = lower(?)', [req.params.username]);
        saveDb();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Stats ────────────────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
    try {
        const players   = get('SELECT COUNT(*) as c FROM players');
        const items     = get('SELECT COUNT(*) as c FROM items');
        const cooldowns = get('SELECT COUNT(*) as c FROM cooldowns');
        const messages  = get('SELECT COUNT(*) as c FROM messages');
        res.json({
            players:   players?.c   || 0,
            items:     items?.c     || 0,
            cooldowns: cooldowns?.c || 0,
            messages:  messages?.c  || 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

// ─── Cooldowns ────────────────────────────────────────────────────────────────

// DELETE /api/admin/cooldowns — alle Cooldowns löschen
router.delete('/cooldowns', (req, res) => {
    try {
        run('DELETE FROM cooldowns');
        res.json({ success: true, message: 'Alle Cooldowns gelöscht' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/admin/cooldowns/:username — Cooldown eines Spielers löschen
router.delete('/cooldowns/:username', (req, res) => {
    try {
        const player = get('SELECT id FROM players WHERE lower(username) = lower(?)', [req.params.username]);
        if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden' });
        run('DELETE FROM cooldowns WHERE player_id = ?', [player.id]);
        res.json({ success: true, username: req.params.username });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Cache ────────────────────────────────────────────────────────────────────

// POST /api/admin/cache/clear — Cache leeren (erzwingt Neuladen aus DB)
router.post('/cache/clear', (req, res) => {
    try {
        invalidateAll();
        res.json({ success: true, message: 'Cache geleert' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Dashboard Users ──────────────────────────────────────────────────────────

// GET /api/admin/users
router.get('/users', (req, res) => {
    try {
        const users = all('SELECT id, username, created_at, updated_at FROM dashboard_users');
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/users — neuen User anlegen
router.post('/users', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username und Passwort erforderlich' });
        if (password.length < 6) return res.status(400).json({ error: 'Passwort muss min. 6 Zeichen haben' });

        const existing = get('SELECT id FROM dashboard_users WHERE lower(username) = lower(?)', [username]);
        if (existing) return res.status(409).json({ error: 'User existiert bereits' });

        const hash = await bcrypt.hash(password, 10);
        run('INSERT INTO dashboard_users (username, password_hash) VALUES (?, ?)', [username.toLowerCase(), hash]);
        saveDb();
        res.json({ success: true, username: username.toLowerCase() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/admin/users/:username
router.delete('/users/:username', (req, res) => {
    try {
        // Selbst löschen verhindern
        if (req.session.username === req.params.username.toLowerCase()) {
            return res.status(400).json({ error: 'Du kannst dich nicht selbst löschen' });
        }
        run('DELETE FROM dashboard_users WHERE lower(username) = lower(?)', [req.params.username]);
        saveDb();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Stats ────────────────────────────────────────────────────────────────────

// GET /api/admin/stats
router.get('/stats', (req, res) => {
    try {
        const players  = get('SELECT COUNT(*) as c FROM players');
        const items    = get('SELECT COUNT(*) as c FROM items');
        const cooldowns = get('SELECT COUNT(*) as c FROM cooldowns');
        const messages = get('SELECT COUNT(*) as c FROM messages');
        res.json({
            players:   players?.c  || 0,
            items:     items?.c    || 0,
            cooldowns: cooldowns?.c || 0,
            messages:  messages?.c || 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
