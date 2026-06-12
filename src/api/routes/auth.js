const express = require('express');
const router  = express.Router();
const { loginUser, logoutUser, changePassword, validateSession } = require('../../db/users');
const sessionMiddleware = require('../middleware/session');

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username und Passwort erforderlich' });
    }

    try {
        const result = await loginUser(username, password);
        if (!result) {
            return res.status(401).json({ error: 'Falscher Benutzername oder Passwort' });
        }
        res.json({
            success:  true,
            token:    result.token,
            username: result.username,
            expires:  result.expiresAt
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/auth/logout
router.post('/logout', sessionMiddleware, (req, res) => {
    const token = req.headers['x-session-token'] || req.headers['x-dashboard-token'];
    logoutUser(token);
    res.json({ success: true });
});

// GET /api/auth/me — Session prüfen
router.get('/me', sessionMiddleware, (req, res) => {
    res.json({ username: req.session.username });
});

// POST /api/auth/change-password
router.post('/change-password', sessionMiddleware, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: 'Altes und neues Passwort erforderlich' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben' });
    }

    try {
        const result = await changePassword(req.session.username, oldPassword, newPassword);
        if (!result.success) {
            return res.status(401).json({ error: result.error });
        }
        res.json({ success: true, message: 'Passwort geändert. Bitte neu einloggen.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
