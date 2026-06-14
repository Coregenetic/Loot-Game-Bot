const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const { run, all, get, saveDb } = require('../../db/schema');
const { invalidateAll } = require('../../db/cache');

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
