const express = require('express');
const router  = express.Router();
const { getPlayer, getOrCreatePlayer, updatePlayer,
        getInventory, getStashValue, getLeaderboard,
        clearInventory, addOrUpdateInventoryItem,
        isOnline } = require('../../db/players');
const { all } = require('../../db/schema');
const { requirePermission } = require('../middleware/permission');
const { logAudit } = require('../../db/audit');

// GET /api/players — alle Spieler
router.get('/', requirePermission('players:view'), (req, res) => {
    try {
        const players = all(`
            SELECT p.id, p.username, p.display_name, p.avatar_url, p.level, p.xp, p.prestige, p.has_kappa,
                   p.raids_total, p.raids_survived, p.raids_died, p.last_seen,
                   COALESCE(SUM(i.count * i.value), 0) AS stash_value,
                   EXISTS(
                       SELECT 1 FROM cooldowns c
                       WHERE c.player_id = p.id AND c.command = 'loot'
                         AND c.expires_at > strftime('%s','now')
                   ) AS in_raid
            FROM players p
            LEFT JOIN inventory i ON i.player_id = p.id
            GROUP BY p.id
            ORDER BY p.prestige DESC, p.level DESC, stash_value DESC
        `);
        const enriched = players.map(p => ({
            ...p,
            in_raid: !!p.in_raid,
            online: isOnline(p)
        })).sort((a, b) => {
            if (a.online !== b.online) return a.online ? -1 : 1;
            if (b.prestige !== a.prestige) return b.prestige - a.prestige;
            if (b.level !== a.level) return b.level - a.level;
            return b.stash_value - a.stash_value;
        });
        res.json(enriched);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/players/:username
router.get('/:username', requirePermission('players:view'), (req, res) => {
    try {
        const player = getPlayer(req.params.username);
        if (!player) return res.status(404).json({ error: 'Player not found' });

        const inventory  = getInventory(player.id);
        const stashValue = getStashValue(player.id);
        const inRaid = all(
            `SELECT 1 FROM cooldowns WHERE player_id = ? AND command = 'loot' AND expires_at > strftime('%s','now')`,
            [player.id]
        ).length > 0;

        res.json({ ...player, inventory, stashValue, online: isOnline(player), inRaid });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/players/:username — Stats setzen, Spieler wird angelegt wenn nicht vorhanden
router.patch('/:username', requirePermission('players:manage'), async (req, res) => {
    try {
        // Spieler anlegen falls nicht vorhanden
        await getOrCreatePlayer(req.params.username);
        const player = getPlayer(req.params.username);
        if (!player) return res.status(404).json({ error: 'Player not found' });

        const allowed = ['level', 'xp', 'prestige', 'has_kappa',
                         'raids_total', 'raids_survived', 'raids_died'];
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }
        if (Object.keys(updates).length) updatePlayer(req.params.username, updates);
        logAudit(req.session.username, 'player_patch', { username: req.params.username, updates });
        res.json({ success: true, username: req.params.username, updates });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/players/:username/inventory — Inventar komplett ersetzen
router.put('/:username/inventory', requirePermission('players:manage'), async (req, res) => {
    try {
        await getOrCreatePlayer(req.params.username);
        const player = getPlayer(req.params.username);
        if (!player) return res.status(404).json({ error: 'Player not found' });

        // Altes Inventar löschen
        clearInventory(player.id);

        // Neues Inventar einfügen
        const inventory = req.body; // { "Item Name": { Count: 1, Value: 1000 }, ... }
        let count = 0;
        for (const [itemName, data] of Object.entries(inventory)) {
            if (itemName === 'Kappa Container') continue; // Kappa ist ein Flag, kein Item
            const qty = data.Count || data.count || 1;
            const val = data.Value || data.value || 0;
            if (qty > 0) {
                addOrUpdateInventoryItem(player.id, itemName, qty, val);
                count++;
            }
        }

        res.json({ success: true, username: req.params.username, items: count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/players/leaderboard/top
router.get('/leaderboard/top', requirePermission('players:view'), (req, res) => {
    try {
        const limit   = parseInt(req.query.limit) || 5;
        const players = getLeaderboard(limit);
        res.json(players);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;