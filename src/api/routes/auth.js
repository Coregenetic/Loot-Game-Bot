const express   = require('express');
const router    = express.Router();
const rateLimit = require('express-rate-limit');
const { loginUser, logoutUser, changePassword } = require('../../db/users');
const sessionMiddleware = require('../middleware/session');
const { logAudit } = require('../../db/audit');

const MIN_PASSWORD_LENGTH = 10;

// Max. 10 Login-Versuche pro 15 Minuten pro IP — zusätzlich zum Account-Lockout
// in db/users.js (der ist pro Account, das hier ist pro IP).
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Login-Versuche. Bitte in 15 Minuten erneut versuchen.' }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username und Passwort erforderlich' });
    }

    try {
        const result = await loginUser(username, password);

        if (result.error === 'locked') {
            return res.status(423).json({ error: `Account gesperrt. Bitte in ${result.minutesLeft} Minuten erneut versuchen.` });
        }
        if (result.error === 'invalid') {
            logAudit(username.toLowerCase(), 'login_failed');
            return res.status(401).json({ error: 'Falscher Benutzername oder Passwort' });
        }

        logAudit(result.username, 'login_success');
        res.json({
            success:  true,
            token:    result.token,
            username: result.username,
            role:     result.role,
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

// GET /api/auth/me — Session prüfen, liefert auch Rolle + Permissions
router.get('/me', sessionMiddleware, (req, res) => {
    const { getRolePermissions } = require('../../db/permissions');
    res.json({
        username:    req.session.username,
        role:        req.session.role,
        permissions: getRolePermissions(req.session.role)
    });
});

// POST /api/auth/change-password
router.post('/change-password', sessionMiddleware, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: 'Altes und neues Passwort erforderlich' });
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben` });
    }

    try {
        const result = await changePassword(req.session.username, oldPassword, newPassword);
        if (!result.success) {
            return res.status(401).json({ error: result.error });
        }
        logAudit(req.session.username, 'password_changed');
        res.json({ success: true, message: 'Passwort geändert. Bitte neu einloggen.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
