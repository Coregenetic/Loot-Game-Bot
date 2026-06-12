const express = require('express');
const router  = express.Router();
const { getAllConfig, setConfig, getConfig } = require('../../db/config');

// GET /api/config — komplette Config
router.get('/', (req, res) => {
    try {
        res.json(getAllConfig());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/config/:section — einzelne Sektion
router.get('/:section', (req, res) => {
    try {
        const data = getConfig(req.params.section);
        if (!data) return res.status(404).json({ error: 'Section not found' });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/config/:section — Sektion updaten
router.put('/:section', (req, res) => {
    try {
        setConfig(req.params.section, req.body);
        res.json({ success: true, section: req.params.section });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
