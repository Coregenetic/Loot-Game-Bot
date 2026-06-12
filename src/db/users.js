const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { get, all, run, saveDb } = require('./schema');

const SALT_ROUNDS   = 10;
const SESSION_HOURS = 24;

// ─── User anlegen ─────────────────────────────────────────────────────────────
async function createUser(username, password) {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    run(
        `INSERT INTO dashboard_users (username, password_hash) VALUES (?, ?)`,
        [username.toLowerCase(), hash]
    );
}

// ─── User existiert? ──────────────────────────────────────────────────────────
function userExists(username) {
    return !!get(`SELECT id FROM dashboard_users WHERE lower(username) = lower(?)`, [username]);
}

function getUserCount() {
    const r = get(`SELECT COUNT(*) as c FROM dashboard_users`);
    return r ? r.c : 0;
}

// ─── Login ────────────────────────────────────────────────────────────────────
async function loginUser(username, password) {
    const user = get(
        `SELECT * FROM dashboard_users WHERE lower(username) = lower(?)`,
        [username]
    );
    if (!user) return null;

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return null;

    // Session erstellen
    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = Math.floor(Date.now() / 1000) + (SESSION_HOURS * 3600);

    run(
        `INSERT INTO dashboard_sessions (token, user_id, username, expires_at) VALUES (?, ?, ?, ?)`,
        [token, user.id, user.username, expiresAt]
    );

    return { token, username: user.username, expiresAt };
}

// ─── Session prüfen ───────────────────────────────────────────────────────────
function validateSession(token) {
    if (!token) return null;
    const session = get(
        `SELECT * FROM dashboard_sessions WHERE token = ?`,
        [token]
    );
    if (!session) return null;
    if (session.expires_at < Math.floor(Date.now() / 1000)) {
        run(`DELETE FROM dashboard_sessions WHERE token = ?`, [token]);
        return null;
    }
    return session;
}

// ─── Logout ───────────────────────────────────────────────────────────────────
function logoutUser(token) {
    run(`DELETE FROM dashboard_sessions WHERE token = ?`, [token]);
}

// ─── Passwort ändern ──────────────────────────────────────────────────────────
async function changePassword(username, oldPassword, newPassword) {
    const user = get(
        `SELECT * FROM dashboard_users WHERE lower(username) = lower(?)`,
        [username]
    );
    if (!user) return { success: false, error: 'User not found' };

    const valid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!valid) return { success: false, error: 'Wrong password' };

    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    run(
        `UPDATE dashboard_users SET password_hash = ?, updated_at = strftime('%s','now') WHERE lower(username) = lower(?)`,
        [hash, username]
    );

    // Alle Sessions invalidieren
    run(`DELETE FROM dashboard_sessions WHERE user_id = ?`, [user.id]);

    return { success: true };
}

// ─── Abgelaufene Sessions aufräumen ──────────────────────────────────────────
function cleanupSessions() {
    run(`DELETE FROM dashboard_sessions WHERE expires_at < strftime('%s','now')`);
}

module.exports = {
    createUser, userExists, getUserCount,
    loginUser, validateSession, logoutUser,
    changePassword, cleanupSessions
};
