const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { get, all, run } = require('./schema');
const { countPasskeys } = require('./passkeys');

const SALT_ROUNDS      = 10;
const SESSION_HOURS     = 24;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES   = 15;
const VALID_ROLES       = ['superadmin', 'admin', 'mod'];

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── User anlegen ─────────────────────────────────────────────────────────────
async function createUser(username, password, role = 'mod') {
    if (!VALID_ROLES.includes(role)) role = 'mod';
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    run(
        `INSERT INTO dashboard_users (username, password_hash, role) VALUES (?, ?, ?)`,
        [username.toLowerCase(), hash, role]
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

function getAllUsers() {
    return all(`SELECT username, role, created_at, updated_at, locked_until FROM dashboard_users ORDER BY username`);
}

function setUserRole(username, role) {
    if (!VALID_ROLES.includes(role)) throw new Error('Ungültige Rolle');
    run(
        `UPDATE dashboard_users SET role = ?, updated_at = strftime('%s','now') WHERE lower(username) = lower(?)`,
        [role, username]
    );
}

// ─── Login (mit Lockout-Schutz gegen Brute-Force) ─────────────────────────────
async function loginUser(username, password) {
    const user = get(
        `SELECT * FROM dashboard_users WHERE lower(username) = lower(?)`,
        [username]
    );
    if (!user) return { error: 'invalid' };

    const now = Math.floor(Date.now() / 1000);
    if (user.locked_until && user.locked_until > now) {
        const minutesLeft = Math.ceil((user.locked_until - now) / 60);
        return { error: 'locked', minutesLeft };
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
        const attempts = (user.failed_attempts || 0) + 1;
        if (attempts >= MAX_FAILED_ATTEMPTS) {
            const lockedUntil = now + LOCKOUT_MINUTES * 60;
            run(`UPDATE dashboard_users SET failed_attempts = 0, locked_until = ? WHERE id = ?`, [lockedUntil, user.id]);
            return { error: 'locked', minutesLeft: LOCKOUT_MINUTES };
        }
        run(`UPDATE dashboard_users SET failed_attempts = ? WHERE id = ?`, [attempts, user.id]);
        return { error: 'invalid' };
    }

    // Erfolgreicher Login — Fehlversuche zurücksetzen
    run(`UPDATE dashboard_users SET failed_attempts = 0, locked_until = 0 WHERE id = ?`, [user.id]);

    // Passkey-Pflicht (PASSKEY_ENFORCE=1): Wer schon einen Passkey hat, darf sich nicht mehr
    // mit dem Passwort anmelden. Wer noch keinen hat, bekommt eine eingeschränkte Session,
    // die nur die Passkey-Einrichtung erreicht.
    let limited = false;
    if (passkeysEnforced()) {
        if (countPasskeys(user.id) > 0) return { error: 'passkey_required' };
        limited = true;
    }

    return createSession(user, limited);
}

function passkeysEnforced() {
    return process.env.PASSKEY_ENFORCE === '1';
}

// ─── Session erstellen — nur der Hash des Tokens landet in der DB ─────────────
function createSession(user, limited = false) {
    const now       = Math.floor(Date.now() / 1000);
    const token     = crypto.randomBytes(32).toString('hex');
    // Eingeschränkte Sessions (Passkey-Einrichtung) laufen nur kurz
    const expiresAt = now + (limited ? 15 * 60 : SESSION_HOURS * 3600);

    run(
        `INSERT INTO dashboard_sessions (token_hash, user_id, username, expires_at, limited) VALUES (?, ?, ?, ?, ?)`,
        [hashToken(token), user.id, user.username, expiresAt, limited ? 1 : 0]
    );

    return { token, username: user.username, role: user.role, expiresAt, limited };
}

function getUserById(id) {
    return get(`SELECT * FROM dashboard_users WHERE id = ?`, [id]);
}

function getUserByName(username) {
    return get(`SELECT * FROM dashboard_users WHERE lower(username) = lower(?)`, [username]);
}

// Nach erfolgreicher Passkey-Einrichtung: eingeschränkte Session zur vollen Session machen
function promoteSession(tokenHash) {
    run(
        `UPDATE dashboard_sessions SET limited = 0, expires_at = ? WHERE token_hash = ?`,
        [Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600, tokenHash]
    );
}

function deleteUserSessions(userId) {
    run(`DELETE FROM dashboard_sessions WHERE user_id = ?`, [userId]);
}

// ─── Session prüfen ───────────────────────────────────────────────────────────
// Eingeschränkte Sessions (limited) gelten nur mit { allowLimited: true } — damit sind sie
// automatisch von allem ausgeschlossen, was validateSession ohne Option nutzt (z.B. WebSockets).
function validateSession(token, { allowLimited = false } = {}) {
    if (!token) return null;
    const session = get(
        `SELECT s.*, u.role FROM dashboard_sessions s
         JOIN dashboard_users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
        [hashToken(token)]
    );
    if (!session) return null;
    if (session.expires_at < Math.floor(Date.now() / 1000)) {
        run(`DELETE FROM dashboard_sessions WHERE token_hash = ?`, [hashToken(token)]);
        return null;
    }
    if (session.limited && !allowLimited) return null;
    return session; // enthält .username und frisch aus der DB gelesenes .role
}

// ─── Logout ───────────────────────────────────────────────────────────────────
function logoutUser(token) {
    run(`DELETE FROM dashboard_sessions WHERE token_hash = ?`, [hashToken(token)]);
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
    VALID_ROLES,
    createUser, userExists, getUserCount, getAllUsers, setUserRole,
    loginUser, validateSession, logoutUser,
    createSession, getUserById, getUserByName, promoteSession, deleteUserSessions, passkeysEnforced,
    changePassword, cleanupSessions
};
