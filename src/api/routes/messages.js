const express = require('express');
const router  = express.Router();
const { getAllMessages, setMessages } = require('../../db/messages');

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
        res.json({ success: true, type });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
