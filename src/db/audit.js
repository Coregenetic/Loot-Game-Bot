const { run, all } = require('./schema');

function logAudit(username, action, details = null) {
    try {
        run(
            `INSERT INTO audit_log (username, action, details, ts) VALUES (?, ?, ?, strftime('%s','now'))`,
            [username, action, details ? JSON.stringify(details) : null]
        );
    } catch (err) {
        console.error('[AUDIT] Logging-Fehler:', err.message);
    }
}

function getAuditLog(limit = 100) {
    const rows = all(`SELECT username, action, details, ts FROM audit_log ORDER BY ts DESC LIMIT ?`, [limit]);
    return rows.map(r => ({
        username: r.username,
        action:   r.action,
        details:  r.details ? JSON.parse(r.details) : null,
        ts:       r.ts
    }));
}

module.exports = { logAudit, getAuditLog };
