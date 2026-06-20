const express = require('express');
const router  = express.Router();
const { getActiveEvents, setConfig } = require('../../db/config');
const { requirePermission } = require('../middleware/permission');
const { logAudit } = require('../../db/audit');

router.use(requirePermission('events:manage'));

// GET /api/events
router.get('/', (req, res) => {
    try {
        res.json(getActiveEvents());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/events/forcedmap
router.put('/forcedmap', (req, res) => {
    try {
        const { mapName, durationMinutes } = req.body;
        const events = getActiveEvents();
        const expiresAt = durationMinutes > 0
            ? Math.floor(Date.now() / 1000) + (durationMinutes * 60)
            : 0;

        events.ForcedMap = { MapName: mapName || '', ExpiresAt: expiresAt };
        setConfig('ActiveEvents', events);

        logAudit(req.session.username, 'event_forcedmap', events.ForcedMap);
        res.json({ success: true, event: events.ForcedMap });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/events/doubleloot
router.put('/doubleloot', (req, res) => {
    try {
        const { chance, durationMinutes } = req.body;
        const events = getActiveEvents();
        const expiresAt = durationMinutes > 0
            ? Math.floor(Date.now() / 1000) + (durationMinutes * 60)
            : 0;

        events.DoubleLootOverride = { Chance: chance || 0, ExpiresAt: expiresAt };
        setConfig('ActiveEvents', events);

        logAudit(req.session.username, 'event_doubleloot', events.DoubleLootOverride);
        res.json({ success: true, event: events.DoubleLootOverride });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/events/xpboost
router.put('/xpboost', (req, res) => {
    try {
        const { multiplier, durationMinutes } = req.body;
        const events = getActiveEvents();
        const expiresAt = durationMinutes > 0
            ? Math.floor(Date.now() / 1000) + (durationMinutes * 60)
            : 0;

        events.XPBoost = { Multiplier: multiplier || 1, ExpiresAt: expiresAt };
        setConfig('ActiveEvents', events);

        logAudit(req.session.username, 'event_xpboost', events.XPBoost);
        res.json({ success: true, event: events.XPBoost });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/events/:type — Event deaktivieren
router.delete('/:type', (req, res) => {
    try {
        const events = getActiveEvents();
        const type   = req.params.type;

        if (type === 'forcedmap')   events.ForcedMap          = { MapName: '', ExpiresAt: 0 };
        if (type === 'doubleloot')  events.DoubleLootOverride = { Chance: 0, ExpiresAt: 0 };
        if (type === 'xpboost')     events.XPBoost            = { Multiplier: 1, ExpiresAt: 0 };

        setConfig('ActiveEvents', events);
        logAudit(req.session.username, 'event_disable', { type });
        res.json({ success: true, type });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
