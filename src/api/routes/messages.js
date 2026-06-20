const express = require('express');
const router  = express.Router();
const { getAllMessages, setMessages } = require('../../db/messages');
const { requirePermission } = require('../middleware/permission');
const { logAudit } = require('../../db/audit');

router.use(requirePermission('items:manage'));

// GET /api/messages
router.get('/', (req, res) => {
    try {
        res.json(getAllMessages());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/messages/:type — exfil, death oder map
router.put('/:type', (req, res) => {
    try {
        const type = req.params.type;
        if (!['exfil', 'death', 'map'].includes(type)) {
            return res.status(400).json({ error: 'Type muss exfil, death oder map sein' });
        }
        setMessages(type, req.body);
        logAudit(req.session.username, 'messages_update', { type });
        res.json({ success: true, type });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
