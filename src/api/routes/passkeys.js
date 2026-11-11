/**
 * Passkeys (WebAuthn / Windows Hello) für Dashboard-Konten.
 * Konfiguration über .env:
 *   WEBAUTHN_RP_ID=lootgamebot.de
 *   WEBAUTHN_ORIGIN=https://lootgamebot.de
 *   PASSKEY_ENFORCE=1   (Passwort-Login nur noch zur Einrichtung)
 */
const express   = require('express');
const crypto    = require('crypto');
const rateLimit = require('express-rate-limit');
const swa       = require('@simplewebauthn/server');
const router    = express.Router();

const sessionMiddleware = require('../middleware/session');
const { requireSuperadmin } = require('../middleware/permission');
const {
    createSession, getUserById, getUserByName, promoteSession, deleteUserSessions, passkeysEnforced
} = require('../../db/users');
const pk = require('../../db/passkeys');
const { logAudit } = require('../../db/audit');

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.' }
});

function rpConfig() {
    const rpID   = process.env.WEBAUTHN_RP_ID;
    const origin = process.env.WEBAUTHN_ORIGIN;
    if (!rpID || !origin) return null;
    return {
        rpID,
        origins: origin.split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean),
        rpName: process.env.WEBAUTHN_RP_NAME || 'Loot-Game Hub'
    };
}

function requireConfigured(req, res, next) {
    req.rp = rpConfig();
    if (!req.rp) return res.status(503).json({ error: 'Passkeys sind auf dem Server nicht konfiguriert.' });
    next();
}

// ─── Challenges (einmalig, 5 Minuten gültig, nur im Speicher) ────────────────
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const challenges = new Map();

function putChallenge(purpose, challenge, userId = null) {
    const now = Date.now();
    for (const [id, c] of challenges) if (c.exp < now) challenges.delete(id);
    if (challenges.size >= 1000) challenges.delete(challenges.keys().next().value);
    const id = crypto.randomBytes(16).toString('hex');
    challenges.set(id, { purpose, challenge, userId, exp: now + CHALLENGE_TTL_MS });
    return id;
}

function takeChallenge(id, purpose, userId = null) {
    const c = typeof id === 'string' ? challenges.get(id) : null;
    if (!c) return null;
    challenges.delete(id); // jede Challenge nur einmal
    if (c.exp < Date.now() || c.purpose !== purpose || c.userId !== userId) return null;
    return c;
}

function parseTransports(json) {
    try { const t = JSON.parse(json || '[]'); return Array.isArray(t) ? t : []; } catch { return []; }
}

function cleanName(raw, fallback) {
    const n = String(raw || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
    return n || fallback;
}

// ─── Öffentlich: Konfiguration fürs Login ─────────────────────────────────────
router.get('/config', (req, res) => {
    res.json({ configured: !!rpConfig(), enforce: passkeysEnforced() });
});

// ─── Login mit Passkey ────────────────────────────────────────────────────────
router.post('/login/options', limiter, requireConfigured, async (req, res) => {
    try {
        const options = await swa.generateAuthenticationOptions({
            rpID: req.rp.rpID,
            userVerification: 'required',
            timeout: 60000
        });
        res.json({ options, challengeId: putChallenge('login', options.challenge) });
    } catch (err) {
        res.status(500).json({ error: 'Passkey-Anfrage fehlgeschlagen' });
    }
});

router.post('/login/verify', limiter, requireConfigured, async (req, res) => {
    const fail = (status = 401) => res.status(status).json({ error: 'Passkey-Anmeldung fehlgeschlagen' });
    try {
        const { challengeId, response } = req.body || {};
        const c = takeChallenge(challengeId, 'login');
        if (!c) return fail(400);

        const cred = pk.getByCredentialId(response && response.id);
        if (!cred) { logAudit('unbekannt', 'passkey_login_failed'); return fail(); }

        const user = getUserById(cred.user_id);
        if (!user) return fail();

        const now = Math.floor(Date.now() / 1000);
        if (user.locked_until && user.locked_until > now) {
            return res.status(423).json({ error: `Account gesperrt. Bitte in ${Math.ceil((user.locked_until - now) / 60)} Minuten erneut versuchen.` });
        }

        let verification;
        try {
            verification = await swa.verifyAuthenticationResponse({
                response,
                expectedChallenge: c.challenge,
                expectedOrigin: req.rp.origins,
                expectedRPID: req.rp.rpID,
                credential: {
                    id: cred.credential_id,
                    publicKey: new Uint8Array(cred.public_key),
                    counter: cred.counter,
                    transports: parseTransports(cred.transports)
                },
                requireUserVerification: true
            });
        } catch (err) {
            logAudit(user.username, 'passkey_login_failed');
            return fail();
        }
        if (!verification.verified) { logAudit(user.username, 'passkey_login_failed'); return fail(); }

        pk.touchPasskey(cred.id, verification.authenticationInfo.newCounter);
        const session = createSession(user, false);
        logAudit(user.username, 'login_success_passkey', { passkey: cred.name });
        res.json({
            success:  true,
            token:    session.token,
            username: session.username,
            role:     session.role,
            expires:  session.expiresAt
        });
    } catch (err) {
        console.error('[PASSKEY] Login-Fehler:', err.message);
        fail(500);
    }
});

// ─── Eigene Passkeys: Übersicht ───────────────────────────────────────────────
router.get('/', sessionMiddleware.allowLimited, (req, res) => {
    res.json({
        configured: !!rpConfig(),
        enforce: passkeysEnforced(),
        limited: !!req.session.limited,
        max: pk.MAX_PASSKEYS_PER_USER,
        passkeys: pk.listPasskeys(req.session.user_id)
    });
});

// ─── Neuen Passkey registrieren ───────────────────────────────────────────────
router.post('/register/options', limiter, requireConfigured, sessionMiddleware.allowLimited, async (req, res) => {
    try {
        const user = getUserById(req.session.user_id);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        if (pk.countPasskeys(user.id) >= pk.MAX_PASSKEYS_PER_USER) {
            return res.status(400).json({ error: `Maximal ${pk.MAX_PASSKEYS_PER_USER} Passkeys pro Konto` });
        }
        const options = await swa.generateRegistrationOptions({
            rpName: req.rp.rpName,
            rpID: req.rp.rpID,
            userName: user.username,
            userDisplayName: user.username,
            userID: new TextEncoder().encode(String(user.id)),
            attestationType: 'none',
            excludeCredentials: pk.listPasskeysWithCredentials(user.id).map(p => ({
                id: p.credential_id,
                transports: parseTransports(p.transports)
            })),
            authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' }, // nur Windows Hello, kein Handy/Sicherheitsschluessel
            timeout: 120000
        });
        res.json({ options, challengeId: putChallenge('register', options.challenge, user.id) });
    } catch (err) {
        console.error('[PASSKEY] Register-Options-Fehler:', err.message);
        res.status(500).json({ error: 'Passkey-Anfrage fehlgeschlagen' });
    }
});

router.post('/register/verify', limiter, requireConfigured, sessionMiddleware.allowLimited, async (req, res) => {
    try {
        const { challengeId, response, name } = req.body || {};
        const user = getUserById(req.session.user_id);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const c = takeChallenge(challengeId, 'register', user.id);
        if (!c) return res.status(400).json({ error: 'Anfrage abgelaufen. Bitte erneut versuchen.' });

        let verification;
        try {
            verification = await swa.verifyRegistrationResponse({
                response,
                expectedChallenge: c.challenge,
                expectedOrigin: req.rp.origins,
                expectedRPID: req.rp.rpID,
                requireUserVerification: true
            });
        } catch (err) {
            return res.status(400).json({ error: 'Passkey konnte nicht verifiziert werden' });
        }
        if (!verification.verified || !verification.registrationInfo) {
            return res.status(400).json({ error: 'Passkey konnte nicht verifiziert werden' });
        }

        const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
        try {
            pk.addPasskey({
                userId: user.id,
                credentialId: credential.id,
                publicKey: credential.publicKey,
                counter: credential.counter,
                transports: credential.transports || (response.response && response.response.transports) || [],
                deviceType: credentialDeviceType,
                backedUp: credentialBackedUp,
                name: cleanName(name, `Passkey ${pk.countPasskeys(user.id) + 1}`)
            });
        } catch (err) {
            if (/UNIQUE/i.test(err.message)) return res.status(409).json({ error: 'Dieser Passkey ist schon registriert' });
            throw err;
        }

        logAudit(user.username, 'passkey_added', { type: credentialDeviceType });
        // Eingeschränkte Session wird nach erfolgreicher Einrichtung zur vollen Session
        const wasLimited = !!req.session.limited;
        if (wasLimited) promoteSession(req.session.token_hash);
        res.json({ success: true, promoted: wasLimited, passkeys: pk.listPasskeys(user.id) });
    } catch (err) {
        console.error('[PASSKEY] Register-Verify-Fehler:', err.message);
        res.status(500).json({ error: 'Passkey-Einrichtung fehlgeschlagen' });
    }
});

// ─── Umbenennen / Löschen (nur volle Session) ─────────────────────────────────
router.patch('/:id', sessionMiddleware, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const name = cleanName(req.body && req.body.name, '');
    if (!Number.isInteger(id) || !name) return res.status(400).json({ error: 'Ungültige Eingabe' });
    if (!pk.renamePasskey(req.session.user_id, id, name)) return res.status(404).json({ error: 'Passkey nicht gefunden' });
    res.json({ success: true });
});

router.delete('/:id', sessionMiddleware, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Ungültige Eingabe' });
    if (passkeysEnforced() && pk.countPasskeys(req.session.user_id) <= 1) {
        return res.status(400).json({ error: 'Der letzte Passkey kann nicht gelöscht werden. Lege zuerst einen zweiten an.' });
    }
    if (!pk.deletePasskey(req.session.user_id, id)) return res.status(404).json({ error: 'Passkey nicht gefunden' });
    logAudit(req.session.username, 'passkey_removed');
    res.json({ success: true });
});

// ─── Superadmin: Anzahl Passkeys je Konto (für die User-Verwaltung) ───────────
router.get('/counts', sessionMiddleware, requireSuperadmin, (req, res) => {
    const { all } = require('../../db/schema');
    const rows = all(`SELECT u.username AS username, COUNT(p.id) AS c
                      FROM dashboard_users u LEFT JOIN admin_passkeys p ON p.user_id = u.id
                      GROUP BY u.id`);
    const out = {};
    for (const r of rows) out[r.username.toLowerCase()] = r.c;
    res.json(out);
});

// ─── Superadmin: Passkeys eines Kontos zurücksetzen (z.B. Gerät verloren) ─────
router.delete('/user/:username', sessionMiddleware, requireSuperadmin, (req, res) => {
    const user = getUserByName(req.params.username);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    const removed = pk.deleteAllPasskeys(user.id);
    deleteUserSessions(user.id);
    logAudit(req.session.username, 'passkeys_reset', { username: user.username, removed });
    res.json({ success: true, removed });
});

module.exports = router;
