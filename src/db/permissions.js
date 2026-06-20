const { run, get } = require('./schema');
const cache = require('./cache');

// ─── Master-Liste aller konfigurierbaren Permissions ──────────────────────────
// 'users:manage' existiert bewusst NICHT in dieser Liste — das bleibt hart an
// die Rolle 'superadmin' gebunden und ist nicht über die Matrix einstellbar,
// sonst könnte sich eine geringer privilegierte Rolle selbst hochstufen.
const PERMISSION_KEYS = [
    'analytics:view',
    'logs:view',
    'cooldowns:manage',
    'players:view',
    'players:manage',
    'events:manage',
    'server:manage',
    'items:manage'
];

const PERMISSION_LABELS = {
    'analytics:view':   'Statistiken & Recap-Karte',
    'logs:view':        'Bot Log',
    'cooldowns:manage': 'Cooldowns',
    'players:view':     'Spieler ansehen',
    'players:manage':   'Spieler bearbeiten (CD-Reset, Item geben)',
    'events:manage':    'Live Events',
    'server:manage':    'Server Control (Wartung, Turnier, Backup, Channel)',
    'items:manage':     'Item Manager'
};

// Default-Belegung beim allerersten Anlegen einer Rolle (danach frei editierbar)
const DEFAULT_PERMISSIONS = {
    admin: [...PERMISSION_KEYS], // alles
    mod: ['analytics:view', 'players:view', 'players:manage', 'cooldowns:manage']
};

function getRolePermissions(role) {
    if (role === 'superadmin') return [...PERMISSION_KEYS]; // immer alles, nicht editierbar

    const cacheKey = 'role_perms_' + role;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const row = get(`SELECT permissions FROM role_permissions WHERE role = ?`, [role]);
    let perms;
    if (row) {
        try { perms = JSON.parse(row.permissions); } catch { perms = []; }
    } else {
        // Rolle noch nie konfiguriert -> Default seeden
        perms = DEFAULT_PERMISSIONS[role] || [];
        setRolePermissions(role, perms);
    }
    cache.set(cacheKey, perms);
    return perms;
}

function setRolePermissions(role, permissions) {
    if (role === 'superadmin') return; // nicht veränderbar
    const clean = permissions.filter(p => PERMISSION_KEYS.includes(p));
    run(
        `INSERT INTO role_permissions (role, permissions, updated_at) VALUES (?, ?, strftime('%s','now'))
         ON CONFLICT(role) DO UPDATE SET permissions = ?, updated_at = strftime('%s','now')`,
        [role, JSON.stringify(clean), JSON.stringify(clean)]
    );
    cache.invalidate('role_perms_' + role);
}

function getAllRolePermissions() {
    return {
        superadmin: [...PERMISSION_KEYS],
        admin: getRolePermissions('admin'),
        mod: getRolePermissions('mod')
    };
}

function hasPermission(role, key) {
    if (role === 'superadmin') return true;
    return getRolePermissions(role).includes(key);
}

module.exports = {
    PERMISSION_KEYS, PERMISSION_LABELS, DEFAULT_PERMISSIONS,
    getRolePermissions, setRolePermissions, getAllRolePermissions, hasPermission
};
