const { hasPermission } = require('../../db/permissions');

// requirePermission('items:manage') -> muss NACH sessionMiddleware stehen,
// braucht req.session.role.
function requirePermission(key) {
    return (req, res, next) => {
        const role = req.session?.role;
        if (!role) return res.status(401).json({ error: 'Unauthorized' });
        if (!hasPermission(role, key)) {
            return res.status(403).json({ error: 'Keine Berechtigung für diese Aktion' });
        }
        next();
    };
}

// Nur für Superadmin-exklusive Aktionen (User-/Rollenverwaltung) — bewusst NICHT
// über die Permission-Matrix einstellbar.
function requireSuperadmin(req, res, next) {
    if (req.session?.role !== 'superadmin') {
        return res.status(403).json({ error: 'Nur für Superadmin verfügbar' });
    }
    next();
}

module.exports = { requirePermission, requireSuperadmin };
