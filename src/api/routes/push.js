const express = require('express');
const router  = express.Router();
const sessionAuth = require('../middleware/session');
const push = require('../../utils/push');

// GET /api/push/vapid-public-key — öffentlich, das Frontend braucht den Key zum Subscriben
router.get('/vapid-public-key', (req, res) => {
    res.json({ key: push.getPublicKey(), configured: push.isConfigured() });
});

// POST /api/push/subscribe
router.post('/subscribe', sessionAuth, (req, res) => {
    try {
        const subscription = req.body;
        if (!subscription || !subscription.endpoint || !subscription.keys) {
            return res.status(400).json({ error: 'Ungültige Subscription' });
        }
        const { get } = require('../../db/schema');
        const user = get(`SELECT id FROM dashboard_users WHERE lower(username) = lower(?)`, [req.session.username]);
        push.saveSubscription(user.id, req.session.username, subscription);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/push/unsubscribe
router.post('/unsubscribe', sessionAuth, (req, res) => {
    try {
        const { endpoint } = req.body;
        if (!endpoint) return res.status(400).json({ error: 'endpoint erforderlich' });
        push.removeSubscription(endpoint);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/push/test — Testbenachrichtigung an alle eigenen Geräte
router.post('/test', sessionAuth, async (req, res) => {
    try {
        const result = await push.sendPushToAll({
            title: '🔔 Test-Benachrichtigung',
            body: 'Push-Notifications funktionieren!',
            url: '/admin.html'
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
