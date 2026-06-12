const express = require('express');
const router  = express.Router();
const { getAllItems, upsertItem, deleteItem } = require('../../db/items');

// GET /api/items
router.get('/', (req, res) => {
    try {
        const items = getAllItems();
        // Als Objekt zurückgeben (wie items.json) für Kompatibilität mit Game Center
        const result = {};
        for (const item of items) {
            result[item.name] = {
                text:    item.text,
                value:   item.value,
                map:     (() => { try { return JSON.parse(item.map); } catch { return item.map; } })(),
                icon:    item.icon,
                isKappa: item.is_kappa === 1
            };
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/items/:name — Item erstellen oder updaten
router.put('/:name', (req, res) => {
    try {
        const name = decodeURIComponent(req.params.name);
        upsertItem(name, req.body);
        res.json({ success: true, name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/items/:name
router.delete('/:name', (req, res) => {
    try {
        const name = decodeURIComponent(req.params.name);
        deleteItem(name);
        res.json({ success: true, name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
