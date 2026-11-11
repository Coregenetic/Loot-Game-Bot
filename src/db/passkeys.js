// Passkeys (WebAuthn / Windows Hello) für Dashboard-Konten
const { get, all, run, getOrOpenDb } = require('./schema');

const MAX_PASSKEYS_PER_USER = 10;

function initPasskeys() {
    const d = getOrOpenDb();
    d.exec(`
        CREATE TABLE IF NOT EXISTS admin_passkeys (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
            credential_id TEXT    NOT NULL UNIQUE,
            public_key    BLOB    NOT NULL,
            counter       INTEGER NOT NULL DEFAULT 0,
            transports    TEXT    NOT NULL DEFAULT '[]',
            device_type   TEXT,
            backed_up     INTEGER NOT NULL DEFAULT 0,
            name          TEXT    NOT NULL,
            created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            last_used_at  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_admin_passkeys_user ON admin_passkeys(user_id);
    `);
    // Sessions nach dem Passwort-Login ohne Passkey sind "limited" (nur Passkey-Einrichtung erlaubt)
    const cols = d.prepare(`PRAGMA table_info(dashboard_sessions)`).all();
    if (!cols.some(c => c.name === 'limited')) {
        d.exec(`ALTER TABLE dashboard_sessions ADD COLUMN limited INTEGER NOT NULL DEFAULT 0`);
    }
}

function countPasskeys(userId) {
    const r = get(`SELECT COUNT(*) AS c FROM admin_passkeys WHERE user_id = ?`, [userId]);
    return r ? r.c : 0;
}

function listPasskeys(userId) {
    return all(
        `SELECT id, name, device_type, backed_up, created_at, last_used_at
         FROM admin_passkeys WHERE user_id = ? ORDER BY created_at`,
        [userId]
    );
}

function listPasskeysWithCredentials(userId) {
    return all(`SELECT credential_id, transports FROM admin_passkeys WHERE user_id = ?`, [userId]);
}

function getByCredentialId(credentialId) {
    if (typeof credentialId !== 'string') return null;
    return get(`SELECT * FROM admin_passkeys WHERE credential_id = ?`, [credentialId]);
}

function addPasskey({ userId, credentialId, publicKey, counter, transports, deviceType, backedUp, name }) {
    run(
        `INSERT INTO admin_passkeys (user_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, credentialId, Buffer.from(publicKey), counter || 0, JSON.stringify(transports || []),
         deviceType || null, backedUp ? 1 : 0, name]
    );
}

function touchPasskey(id, counter) {
    run(
        `UPDATE admin_passkeys SET counter = ?, last_used_at = strftime('%s','now') WHERE id = ?`,
        [counter || 0, id]
    );
}

function renamePasskey(userId, id, name) {
    return run(`UPDATE admin_passkeys SET name = ? WHERE id = ? AND user_id = ?`, [name, id, userId]).changes > 0;
}

function deletePasskey(userId, id) {
    return run(`DELETE FROM admin_passkeys WHERE id = ? AND user_id = ?`, [id, userId]).changes > 0;
}

function deleteAllPasskeys(userId) {
    return run(`DELETE FROM admin_passkeys WHERE user_id = ?`, [userId]).changes;
}

module.exports = {
    MAX_PASSKEYS_PER_USER,
    initPasskeys, countPasskeys, listPasskeys, listPasskeysWithCredentials,
    getByCredentialId, addPasskey, touchPasskey, renamePasskey, deletePasskey, deleteAllPasskeys
};
