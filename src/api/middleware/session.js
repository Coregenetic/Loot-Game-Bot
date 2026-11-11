const { validateSession } = require('../../db/users');

function sessionMiddleware(req, res, next) {
    // Token nur aus Headern — nicht aus der URL (landet sonst in Logs/Verlauf/Referrer)
    const token =
        req.headers['x-session-token'] ||
        req.headers['x-dashboard-token'];

    // Rolle wird bei JEDEM Request frisch aus der DB gelesen (kein Caching in der
    // Session selbst) — Rollenänderungen greifen so sofort, nicht erst nach Re-Login.
    const session = validateSession(token);
    if (!session) {
        return res.status(401).json({ error: 'Unauthorized', redirect: '/login.html' });
    }

    req.session = session; // enthält .username und .role
    next();
}

module.exports = sessionMiddleware;
