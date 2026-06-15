const express = require('express');
const router  = express.Router();
const { getPlayer, getOrCreatePlayer, updatePlayer,
        getInventory, getStashValue, getLeaderboard,
        clearInventory, addOrUpdateInventoryItem } = require('../../db/players');
const { all } = require('../../db/schema');

// GET /api/players — alle Spieler
router.get('/', (req, res) => {
    try {
        const players = all(`
            SELECT p.id, p.username, p.level, p.xp, p.prestige, p.has_kappa,
                   p.raids_total, p.raids_survived, p.raids_died,
                   COALESCE(SUM(i.count * i.value), 0) AS stash_value
            FROM players p
            LEFT JOIN inventory i ON i.player_id = p.id
            GROUP BY p.id
            ORDER BY p.prestige DESC, p.level DESC, stash_value DESC
        `);
        res.json(players);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/players/:username
router.get('/:username', (req, res) => {
    try {
        const player = getPlayer(req.params.username);
        if (!player) return res.status(404).json({ error: 'Player not found' });
        const inventory  = getInventory(player.id);
        const stashValue = getStashValue(player.id);
        res.json({ ...player, inventory, stashValue });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/players/:username — Stats setzen, Spieler wird angelegt wenn nicht vorhanden
router.patch('/:username', async (req, res) => {
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
        res.json({ success: true, username: req.params.username, updates });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/players/:username/inventory — Inventar komplett ersetzen
router.put('/:username/inventory', async (req, res) => {
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
router.get('/leaderboard/top', (req, res) => {
    try {
        const limit   = parseInt(req.query.limit) || 5;
        const players = getLeaderboard(limit);
        res.json(players);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;


// GET /api/players — alle Spieler (Leaderboard-Daten)
router.get('/', (req, res) => {
    try {
        const players = all(`
            SELECT p.id, p.username, p.level, p.xp, p.prestige, p.has_kappa,
                   p.raids_total, p.raids_survived, p.raids_died,
                   COALESCE(SUM(i.count * i.value), 0) AS stash_value
            FROM players p
            LEFT JOIN inventory i ON i.player_id = p.id
            GROUP BY p.id
            ORDER BY p.prestige DESC, p.level DESC, stash_value DESC
        `);
        res.json(players);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/players/:username
router.get('/:username', (req, res) => {
    try {
        const player = getPlayer(req.params.username);
        if (!player) return res.status(404).json({ error: 'Player not found' });

        const inventory  = getInventory(player.id);
        const stashValue = getStashValue(player.id);

        res.json({ ...player, inventory, stashValue });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/players/:username — Spielerdaten anpassen (Admin)
router.patch('/:username', (req, res) => {
    try {
        const player = getPlayer(req.params.username);
        if (!player) return res.status(404).json({ error: 'Player not found' });

        // Nur erlaubte Felder
        const allowed = ['level', 'xp', 'prestige', 'has_kappa',
                         'raids_total', 'raids_survived', 'raids_died'];
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }

        if (Object.keys(updates).length) {
            updatePlayer(req.params.username, updates);
        }

        res.json({ success: true, username: req.params.username, updates });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/players/leaderboard/top
router.get('/leaderboard/top', (req, res) => {
    try {
        const limit   = parseInt(req.query.limit) || 5;
        const players = getLeaderboard(limit);
        res.json(players);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;