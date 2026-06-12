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

// PUT /api/messages/:type — exfil oder death
router.put('/:type', (req, res) => {
    try {
        const type = req.params.type;
        if (!['exfil', 'death'].includes(type)) {
            return res.status(400).json({ error: 'Type muss exfil oder death sein' });
        }
        setMessages(type, req.body);
        res.json({ success: true, type });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
