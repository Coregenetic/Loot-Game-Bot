const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const { run, all, get, saveDb } = require('../../db/schema');
const { invalidateAll } = require('../../db/cache');
const { requirePermission, requireSuperadmin } = require('../middleware/permission');
const { logAudit, getAuditLog } = require('../../db/audit');
const {
    PERMISSION_KEYS, PERMISSION_LABELS,
    getAllRolePermissions, setRolePermissions
} = require('../../db/permissions');
const { createUser, userExists, getAllUsers, setUserRole, VALID_ROLES } = require('../../db/users');

const MIN_PASSWORD_LENGTH = 10;

// ─── Analytics ────────────────────────────────────────────────────────────────

router.get('/analytics', requirePermission('analytics:view'), (req, res) => {
    try {
        const { readLogs, calcStats } = require('../../utils/analytics');
        const days  = parseInt(req.query.days) || 7;
        const since = Date.now() - days * 24 * 60 * 60 * 1000;
        const logs  = readLogs(0).filter(l => l.ts >= since);
        res.json({ days, total: logs.length, stats: calcStats(logs) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/recap?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/recap', requirePermission('analytics:view'), (req, res) => {
    try {
        const { readLogs } = require('../../utils/analytics');
        const { from, to } = req.query;
        if (!from || !to) return res.status(400).json({ error: 'from und to sind erforderlich (YYYY-MM-DD)' });

        const fromMs = new Date(from + 'T00:00:00').getTime();
        const toMs   = new Date(to   + 'T23:59:59.999').getTime();
        if (isNaN(fromMs) || isNaN(toMs)) return res.status(400).json({ error: 'Ungültiges Datum' });

        const logs = readLogs(0).filter(l => l.cmd === '!loot' && l.ts >= fromMs && l.ts <= toMs);

        const totalRaids = logs.length;
        const survived   = logs.filter(l => l.survived === true).length;
        const died       = logs.filter(l => l.survived === false).length;
        const survivalRate = totalRaids > 0 ? Math.round((survived / totalRaids) * 100) : 0;

        const valueByUser = {};
        for (const l of logs) {
            if (l.itemValue) valueByUser[l.user] = (valueByUser[l.user] || 0) + l.itemValue;
        }
        const topLooterEntry = Object.entries(valueByUser).sort((a, b) => b[1] - a[1])[0];
        const topLooter = topLooterEntry ? { username: topLooterEntry[0], value: topLooterEntry[1] } : null;

        let biggestDrop = null;
        for (const l of logs) {
            if (l.itemValue && (!biggestDrop || l.itemValue > biggestDrop.value)) {
                biggestDrop = { username: l.user, itemName: l.itemName, value: l.itemValue };
            }
        }

        const mapCounts = {};
        for (const l of logs) {
            if (l.map) mapCounts[l.map] = (mapCounts[l.map] || 0) + 1;
        }
        const topMapEntry = Object.entries(mapCounts).sort((a, b) => b[1] - a[1])[0];
        const topMap = topMapEntry ? { name: topMapEntry[0], count: topMapEntry[1] } : null;

        const totalValue = logs.reduce((sum, l) => sum + (l.itemValue || 0), 0);

        res.json({ from, to, totalRaids, survived, died, survivalRate, totalValue, topLooter, biggestDrop, topMap });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Turnier-Modus ────────────────────────────────────────────────────────────

router.get('/tournament', requirePermission('server:manage'), (req, res) => {
    const bot = global.botInstance;
    res.json({ active: bot ? bot.getTournamentMode() : false });
});

router.post('/tournament', requirePermission('server:manage'), (req, res) => {
    const { active } = req.body;
    const bot = global.botInstance;
    if (!bot) return res.status(503).json({ error: 'Bot nicht bereit' });
    bot.setTournament(active);
    logAudit(req.session.username, 'tournament_toggle', { active });
    require('../../utils/wsHub').broadcast({ type: 'bot_status', kind: 'tournament', active });
    res.json({ success: true, active });
});

// ─── Wartungsmodus ────────────────────────────────────────────────────────────

router.get('/maintenance', requirePermission('server:manage'), (req, res) => {
    const bot = global.botInstance;
    res.json({ active: bot ? bot.getMaintenanceMode() : false });
});

router.post('/maintenance', requirePermission('server:manage'), (req, res) => {
    const { active } = req.body;
    const bot = global.botInstance;
    if (!bot) return res.status(503).json({ error: 'Bot nicht bereit' });
    bot.setMaintenance(active);
    logAudit(req.session.username, 'maintenance_toggle', { active });
    require('../../utils/wsHub').broadcast({ type: 'bot_status', kind: 'maintenance', active });
    res.json({ success: true, active });
});

// ─── Fly.io Machine Info ──────────────────────────────────────────────────────

router.get('/machine', requirePermission('server:manage'), (req, res) => {
    try {
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
            uptime:      Math.floor(process.uptime()),
            memory:      process.memoryUsage(),
            node:        process.version,
            pid:         process.pid,
            platform:    process.platform,
            channel:     process.env.TWITCH_CHANNEL || '—',
            env:         process.env.NODE_ENV || 'production'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Server-Zugriff prüfen (für's Frontend: Tab automatisch freischalten) ─────
router.get('/server/access-check', requirePermission('server:manage'), (req, res) => {
    res.json({ success: true });
});

// ─── Backups ──────────────────────────────────────────────────────────────────

router.get('/backups', requirePermission('server:manage'), (req, res) => {
    try {
        const { listBackups } = require('../../utils/backup');
        res.json(listBackups());
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/backups/create', requirePermission('server:manage'), (req, res) => {
    try {
        const { createBackup } = require('../../utils/backup');
        const backup = createBackup('manual');
        logAudit(req.session.username, 'backup_create', { filename: backup.filename });
        res.json({ success: true, backup });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/backups/restore', requirePermission('server:manage'), (req, res) => {
    try {
        const { filename } = req.body;
        if (!filename) return res.status(400).json({ error: 'Dateiname erforderlich' });
        const { restoreBackup } = require('../../utils/backup');
        restoreBackup(filename);
        logAudit(req.session.username, 'backup_restore', { filename });
        res.json({ success: true, message: 'Backup wiederherstellt. Server-Neustart empfohlen damit die Änderungen greifen.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/backups/:filename', requirePermission('server:manage'), (req, res) => {
    try {
        const { deleteBackup } = require('../../utils/backup');
        deleteBackup(req.params.filename);
        logAudit(req.session.username, 'backup_delete', { filename: req.params.filename });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/backups/:filename/download', requirePermission('server:manage'), (req, res) => {
    try {
        const { getBackupPath } = require('../../utils/backup');
        const filepath = getBackupPath(req.params.filename);
        res.download(filepath, req.params.filename);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Backup-Inhalt einsehen (read-only) ───────────────────────────────────────
router.get('/backups/:filename/inspect', requirePermission('server:manage'), async (req, res) => {
    try {
        const { inspectBackup } = require('../../utils/backup');
        const counts = await inspectBackup(req.params.filename);
        res.json({ filename: req.params.filename, tables: counts });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Gezielt einzelne Tabellen aus einem Backup wiederherstellen ─────────────
router.post('/backups/:filename/restore-tables', requirePermission('server:manage'), async (req, res) => {
    try {
        const { tables } = req.body;
        if (!Array.isArray(tables) || !tables.length) {
            return res.status(400).json({ error: 'tables muss ein nicht-leeres Array sein' });
        }
        const { restoreTablesFromBackup, SELECTIVE_TABLES } = require('../../utils/backup');
        const schemaModule = require('../../db/schema');

        const invalid = tables.filter(t => !SELECTIVE_TABLES.includes(t));
        if (invalid.length) {
            return res.status(400).json({ error: 'Nicht erlaubte Tabellen: ' + invalid.join(', ') + ' (erlaubt: ' + SELECTIVE_TABLES.join(', ') + ')' });
        }

        const restored = await restoreTablesFromBackup(req.params.filename, tables, schemaModule);
        invalidateAll();
        logAudit(req.session.username, 'backup_restore_tables', { filename: req.params.filename, tables: restored });
        res.json({ success: true, filename: req.params.filename, restored });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Item zu Spieler geben ────────────────────────────────────────────────────

router.post('/give-item', requirePermission('players:manage'), async (req, res) => {
    try {
        const { username, itemName, count } = req.body;
        if (!username || !itemName) return res.status(400).json({ error: 'Username und Item erforderlich' });

        const { getOrCreatePlayer, addOrUpdateInventoryItem } = require('../../db/players');
        const { getAllItems } = require('../../db/items');

        const items = getAllItems();
        const item  = items.find(i => (i.text || i.name).toLowerCase() === itemName.toLowerCase());
        if (!item) return res.status(404).json({ error: 'Item nicht in der Datenbank gefunden' });

        const player = await getOrCreatePlayer(username);
        const qty    = Math.max(1, parseInt(count) || 1);
        addOrUpdateInventoryItem(player.id, item.text || item.name, qty, item.value || 0, item.name);

        logAudit(req.session.username, 'give_item', { username, itemName: item.text || item.name, count: qty });
        res.json({ success: true, username, itemName: item.text || item.name, count: qty });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Command Control ──────────────────────────────────────────────────────────

router.get('/commands', requirePermission('server:manage'), (req, res) => {
    try {
        const bot = global.botInstance;
        if (!bot) return res.status(503).json({ error: 'Bot nicht bereit' });
        res.json(bot.getCommandStatus());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/commands/:cmd', requirePermission('server:manage'), (req, res) => {
    try {
        const bot = global.botInstance;
        if (!bot) return res.status(503).json({ error: 'Bot nicht bereit' });

        const cmd    = req.params.cmd.toLowerCase();
        const active = req.body.active !== false;
        bot.setCommandActive(cmd, active);

        logAudit(req.session.username, 'command_toggle', { cmd, active });
        require('../../utils/wsHub').broadcast({ type: 'bot_status', kind: 'command', cmd, active });
        res.json({ success: true, cmd, active });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Channel Control ──────────────────────────────────────────────────────────

router.get('/channels', requirePermission('server:manage'), (req, res) => {
    try {
        const bot = global.botInstance;
        if (!bot) return res.status(503).json({ error: 'Bot nicht bereit' });
        res.json(bot.getChannelStatus());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/channels/:channel', requirePermission('server:manage'), (req, res) => {
    try {
        const bot = global.botInstance;
        if (!bot) return res.status(503).json({ error: 'Bot nicht bereit' });

        const channel = req.params.channel.toLowerCase();
        const active  = req.body.active !== false;
        bot.setChannelActive(channel, active);

        logAudit(req.session.username, 'channel_toggle', { channel, active });
        require('../../utils/wsHub').broadcast({ type: 'bot_status', kind: 'channel', channel, active });
        res.json({ success: true, channel, active });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Bot reconnect ────────────────────────────────────────────────────────────
router.post('/server/reconnect', requirePermission('server:manage'), (req, res) => {
    try {
        logAudit(req.session.username, 'server_reconnect');
        setTimeout(() => { process.emit('SIGTERM'); }, 500);
        res.json({ success: true, message: 'Bot wird neu gestartet...' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Cache leeren ─────────────────────────────────────────────────────────────
router.post('/server/cache', requirePermission('server:manage'), (req, res) => {
    try {
        invalidateAll();
        logAudit(req.session.username, 'cache_clear');
        res.json({ success: true, message: 'Cache geleert — alle Daten werden neu geladen' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/cache/clear', requirePermission('server:manage'), (req, res) => {
    try {
        invalidateAll();
        logAudit(req.session.username, 'cache_clear');
        res.json({ success: true, message: 'Cache geleert' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── DB Snapshot ──────────────────────────────────────────────────────────────
router.post('/server/snapshot', requirePermission('server:manage'), (req, res) => {
    try {
        saveDb();
        logAudit(req.session.username, 'db_snapshot');
        res.json({ success: true, message: 'DB Snapshot gespeichert' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Server Info ──────────────────────────────────────────────────────────────
router.get('/server/info', requirePermission('server:manage'), (req, res) => {
    res.json({
        uptime:   process.uptime(),
        memory:   process.memoryUsage(),
        node:     process.version,
        env:      process.env.NODE_ENV,
        channel:  process.env.TWITCH_CHANNEL
    });
});

// ─── Cooldowns ────────────────────────────────────────────────────────────────
router.delete('/cooldowns', requirePermission('cooldowns:manage'), (req, res) => {
    try {
        run('DELETE FROM cooldowns');
        logAudit(req.session.username, 'cooldowns_clear_all');
        res.json({ success: true, message: 'Alle Cooldowns gelöscht' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/cooldowns/:username', requirePermission('cooldowns:manage'), (req, res) => {
    try {
        const player = get('SELECT id FROM players WHERE lower(username) = lower(?)', [req.params.username]);
        if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden' });
        run('DELETE FROM cooldowns WHERE player_id = ?', [player.id]);
        logAudit(req.session.username, 'cooldown_clear', { username: req.params.username });
        res.json({ success: true, username: req.params.username });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Dashboard Users & Rollen (nur Superadmin) ────────────────────────────────

router.get('/users', requireSuperadmin, (req, res) => {
    try {
        res.json(getAllUsers());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/users', requireSuperadmin, async (req, res) => {
    try {
        const { username, password, role } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username und Passwort erforderlich' });
        if (password.length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({ error: `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben` });
        }
        if (role && !VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Ungültige Rolle' });

        if (userExists(username)) return res.status(409).json({ error: 'User existiert bereits' });

        await createUser(username, password, role || 'mod');
        logAudit(req.session.username, 'user_create', { username: username.toLowerCase(), role: role || 'mod' });
        res.json({ success: true, username: username.toLowerCase() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.patch('/users/:username/role', requireSuperadmin, (req, res) => {
    try {
        const { role } = req.body;
        if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Ungültige Rolle' });
        if (req.session.username === req.params.username.toLowerCase() && role !== 'superadmin') {
            return res.status(400).json({ error: 'Du kannst dir nicht selbst die Superadmin-Rolle entziehen' });
        }
        setUserRole(req.params.username, role);
        logAudit(req.session.username, 'user_role_change', { username: req.params.username, role });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/users/:username', requireSuperadmin, (req, res) => {
    try {
        if (req.session.username === req.params.username.toLowerCase()) {
            return res.status(400).json({ error: 'Du kannst dich nicht selbst löschen' });
        }
        run('DELETE FROM dashboard_users WHERE lower(username) = lower(?)', [req.params.username]);
        saveDb();
        logAudit(req.session.username, 'user_delete', { username: req.params.username });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Rollen-Permission-Matrix (nur Superadmin) ────────────────────────────────

router.get('/permissions', requireSuperadmin, (req, res) => {
    res.json({
        keys:   PERMISSION_KEYS,
        labels: PERMISSION_LABELS,
        roles:  getAllRolePermissions()
    });
});

router.put('/permissions/:role', requireSuperadmin, (req, res) => {
    try {
        const { role } = req.params;
        const { permissions } = req.body;
        if (role === 'superadmin') return res.status(400).json({ error: 'Superadmin-Rechte sind nicht editierbar' });
        if (!Array.isArray(permissions)) return res.status(400).json({ error: 'permissions muss ein Array sein' });

        setRolePermissions(role, permissions);
        logAudit(req.session.username, 'permissions_change', { role, permissions });
        res.json({ success: true, role, permissions });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Audit-Log (nur Superadmin) ───────────────────────────────────────────────

router.get('/audit', requireSuperadmin, (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        res.json(getAuditLog(limit));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── EventSub-Shadow (Bot-Badge-Migration, Phase 1) — manuelles Testen ───────
router.get('/eventsub-shadow/status', requirePermission('server:manage'), (req, res) => {
    const shadow = global.eventSubShadow;
    res.json({
        enabled: !!shadow,
        ready:   shadow ? shadow.isReady() : false
    });
});

router.post('/eventsub-shadow/test-send', requirePermission('server:manage'), async (req, res) => {
    try {
        const shadow = global.eventSubShadow;
        if (!shadow) return res.status(503).json({ error: 'EventSub-Shadow ist nicht aktiviert (ENABLE_EVENTSUB_SHADOW)' });

        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'message erforderlich' });

        await shadow.sendChatMessage(message);
        logAudit(req.session.username, 'eventsub_shadow_test_send', { message });
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
