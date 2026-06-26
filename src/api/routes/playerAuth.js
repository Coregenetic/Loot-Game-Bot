/**
 * Player-Auth — komplett getrennt vom Dashboard-Auth-System (auth.js/users.js).
 * Zuschauer loggen sich per Twitch-OAuth ein, um NUR ihre eigenen Spieler-Daten
 * zu sehen (Stash/Kappa/Inventar/Historie). Niemals Admin-Rechte, niemals
 * Verknüpfung zu dashboard_users. Der Username kommt ausschließlich aus der
 * verifizierten Twitch-Identität — niemals aus Query/Body/Param.
 */
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { run, get, all } = require('../../db/schema');

const CLIENT_ID     = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const SESSION_HOURS = 24 * 7; // eine Woche, unkritisch da nur Lesezugriff auf eigene Daten

// ─── CSRF-State (kurzlebig, in-memory reicht für diesen Zweck) ───────────────
const pendingStates = new Map(); // state -> expiresAt (ms)
function createState() {
    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.set(state, Date.now() + 5 * 60 * 1000);
    return state;
}
function consumeState(state) {
    const expiresAt = pendingStates.get(state);
    pendingStates.delete(state);
    return !!expiresAt && expiresAt > Date.now();
}
setInterval(() => {
    const now = Date.now();
    for (const [s, exp] of pendingStates) if (exp <= now) pendingStates.delete(s);
}, 5 * 60 * 1000);

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function getRedirectUri(req) {
    return `${req.protocol}://${req.get('host')}/api/player-auth/callback`;
}

// ─── 1. Login: zu Twitch weiterleiten ─────────────────────────────────────────
router.get('/login', (req, res) => {
    if (!CLIENT_ID) return res.status(503).send('Twitch-Login ist noch nicht konfiguriert.');
    const state = createState();
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: getRedirectUri(req),
        response_type: 'code',
        scope: '',
        state
    });
    res.redirect(`https://id.twitch.tv/oauth2/authorize?${params.toString()}`);
});

// ─── 2. Callback: Code gegen Identität tauschen, Session anlegen ─────────────
router.get('/callback', async (req, res) => {
    try {
        const { code, state, error: oauthError } = req.query;
        if (oauthError) return res.redirect('/player-login.html?error=denied');
        if (!code || !state || !consumeState(state)) {
            return res.redirect('/player-login.html?error=invalid_state');
        }

        const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: getRedirectUri(req)
            })
        });
        if (!tokenRes.ok) return res.redirect('/player-login.html?error=token_exchange');
        const tokenData = await tokenRes.json();

        const userRes = await fetch('https://api.twitch.tv/helix/users', {
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'Client-Id': CLIENT_ID
            }
        });
        if (!userRes.ok) return res.redirect('/player-login.html?error=user_lookup');
        const userData = await userRes.json();
        const twitchUser = userData.data?.[0];
        if (!twitchUser) return res.redirect('/player-login.html?error=user_lookup');

        // Session anlegen — Username kommt ab hier NUR noch aus der DB-Session,
        // nie wieder aus einer Anfrage des Clients.
        const sessionToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600;
        run(
            `INSERT INTO player_sessions (token_hash, username, twitch_user_id, expires_at) VALUES (?, ?, ?, ?)`,
            [hashToken(sessionToken), twitchUser.login, twitchUser.id, expiresAt]
        );

        res.redirect(`/player-hub.html#token=${sessionToken}`);
    } catch (err) {
        console.error('[PLAYER-AUTH] Callback-Fehler:', err.message);
        res.redirect('/player-login.html?error=server_error');
    }
});

// ─── Middleware: Session prüfen ───────────────────────────────────────────────
function playerSessionAuth(req, res, next) {
    const token = req.headers['x-player-token'];
    if (!token) return res.status(401).json({ error: 'Nicht eingeloggt' });

    const session = get(
        `SELECT * FROM player_sessions WHERE token_hash = ?`,
        [hashToken(token)]
    );
    if (!session || session.expires_at < Math.floor(Date.now() / 1000)) {
        if (session) run(`DELETE FROM player_sessions WHERE token_hash = ?`, [hashToken(token)]);
        return res.status(401).json({ error: 'Session abgelaufen' });
    }

    req.playerUsername = session.username; // einzige Quelle der Wahrheit für "wer bin ich"
    next();
}

// ─── 3. Logout ────────────────────────────────────────────────────────────────
router.post('/logout', playerSessionAuth, (req, res) => {
    const token = req.headers['x-player-token'];
    run(`DELETE FROM player_sessions WHERE token_hash = ?`, [hashToken(token)]);
    res.json({ success: true });
});

// ─── 4. Identität ─────────────────────────────────────────────────────────────
router.get('/me', playerSessionAuth, (req, res) => {
    res.json({ username: req.playerUsername });
});

// ─── 5. Eigene Stats ──────────────────────────────────────────────────────────
router.get('/my-stats', playerSessionAuth, (req, res) => {
    try {
        const { getPlayer, getInventory, getStashValue, getRemainingCooldown } = require('../../db/players');
        const { getKappaItems } = require('../../db/items');
        const { readLogs } = require('../../utils/analytics');

        const player = getPlayer(req.playerUsername);
        if (!player) return res.status(404).json({ error: 'Kein Spieler-Profil gefunden — spiel erstmal eine Runde mit !loot im Chat.' });

        const stashValue = getStashValue(player.id);
        const inventory  = getInventory(player.id);

        // Rang/Perzentil unter allen Spielern
        const allPlayers = all(`
            SELECT p.id, COALESCE(SUM(i.count * i.value), 0) AS stash_value
            FROM players p LEFT JOIN inventory i ON i.player_id = p.id
            GROUP BY p.id
        `);
        const sorted = allPlayers.sort((a, b) => b.stash_value - a.stash_value);
        const rank   = sorted.findIndex(p => p.id === player.id) + 1;

        // Kappa-Fortschritt
        const kappaItems = getKappaItems();
        const ownedKeys  = new Set(inventory.map(i => i.item_name?.toLowerCase()));
        const missing    = kappaItems.filter(k => !ownedKeys.has((k.text || k.name).toLowerCase()));

        // Cooldown / Raid-Status
        const remaining = getRemainingCooldown(player.id, 'loot');

        // Letzte Raids aus dem Analytics-Log
        const logs = readLogs(0)
            .filter(l => l.cmd === '!loot' && l.user?.toLowerCase() === req.playerUsername.toLowerCase())
            .sort((a, b) => b.ts - a.ts)
            .slice(0, 10)
            .map(l => ({ ts: l.ts, map: l.map, survived: l.survived, itemValue: l.itemValue || 0, itemName: l.itemName || null }));

        res.json({
            username: player.username,
            level: player.level || 1,
            xp: player.xp || 0,
            prestige: player.prestige || 0,
            hasKappa: player.has_kappa === 1,
            stashValue,
            rank,
            totalPlayers: sorted.length,
            raidsTotal: player.raids_total || 0,
            raidsSurvived: player.raids_survived || 0,
            raidsDied: player.raids_died || 0,
            survivalRate: player.raids_total > 0 ? Math.round((player.raids_survived / player.raids_total) * 100) : 0,
            kappa: {
                found: kappaItems.length - missing.length,
                total: kappaItems.length,
                missing: missing.slice(0, 5).map(m => m.text || m.name)
            },
            cooldownRemaining: remaining,
            recentRaids: logs
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── 6. Eigenes Inventar (vollständig) ───────────────────────────────────────
router.get('/my-inventory', playerSessionAuth, (req, res) => {
    try {
        const { getPlayer, getInventory } = require('../../db/players');
        const player = getPlayer(req.playerUsername);
        if (!player) return res.status(404).json({ error: 'Kein Spieler-Profil gefunden.' });

        res.json({ inventory: getInventory(player.id) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = { router, playerSessionAuth };
