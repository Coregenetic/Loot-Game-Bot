const { validateSession } = require('../../db/users');

function build(allowLimited) {
    return function sessionMiddleware(req, res, next) {
        // Token nur aus Headern — nicht aus der URL (landet sonst in Logs/Verlauf/Referrer)
        const token =
            req.headers['x-session-token'] ||
            req.headers['x-dashboard-token'];

        // Rolle wird bei JEDEM Request frisch aus der DB gelesen (kein Caching in der
        // Session selbst) — Rollenänderungen greifen so sofort, nicht erst nach Re-Login.
        const session = validateSession(token, { allowLimited: true });
        if (!session) {
            return res.status(401).json({ error: 'Unauthorized', redirect: '/login.html' });
        }

        // Eingeschränkte Session (Passwort-Login ohne Passkey bei aktiver Passkey-Pflicht):
        // darf nur Routen nutzen, die ausdrücklich allowLimited verwenden.
        if (session.limited && !allowLimited) {
            return res.status(403).json({
                error: 'Bitte zuerst einen Passkey einrichten.',
                code: 'passkey_setup_required',
                redirect: '/passkey-setup.html'
            });
        }

        req.session = session; // enthält .username und .role
        next();
    };
}

module.exports = build(false);
module.exports.allowLimited = build(true);
