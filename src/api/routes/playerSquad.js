/**
 * Squad-Verwaltung — eigene Routen, nutzt aber dieselbe playerSessionAuth
 * Middleware wie der Rest des Player Hubs. Reine Verwaltung hier (Schritt 1);
 * die eigentliche "gemeinsam in den Raid"-Mechanik kommt erst in Schritt 2.
 */
const express = require('express');
const router  = express.Router();
const { run, get, all } = require('../../db/schema');
const { playerSessionAuth } = require('./playerAuth');

const MAX_SQUAD_SIZE = 5; // Leader + 4 Mitglieder, wie im echten Tarkov

function getMySquad(username) {
    const membership = get(
        `SELECT sm.*, s.name, s.leader_username, s.icon, s.color FROM squad_members sm
         JOIN squads s ON s.id = sm.squad_id
         WHERE lower(sm.username) = lower(?) AND sm.status = 'accepted'`,
        [username]
    );
    if (!membership) return null;

    const { isOnline } = require('../../db/players');
    const members = all(
        `SELECT sm.username, sm.status, sm.invited_at, p.display_name, p.avatar_url, p.level, p.last_seen
         FROM squad_members sm
         LEFT JOIN players p ON lower(p.username) = lower(sm.username)
         WHERE sm.squad_id = ? ORDER BY sm.invited_at ASC`,
        [membership.squad_id]
    ).map(m => ({
        username: m.username,
        displayName: m.display_name || m.username,
        avatarUrl: m.avatar_url || null,
        level: m.level || 1,
        status: m.status,
        invited_at: m.invited_at,
        online: isOnline({ last_seen: m.last_seen })
    }));

    return {
        id: membership.squad_id,
        name: membership.name,
        leaderUsername: membership.leader_username,
        icon: membership.icon,
        color: membership.color,
        members
    };
}

// ─── Eigenes Squad ansehen ─────────────────────────────────────────────────────
router.get('/my', playerSessionAuth, (req, res) => {
    res.json({ squad: getMySquad(req.playerUsername) });
});

// ─── Eigene offene Einladungen ─────────────────────────────────────────────────
router.get('/invites', playerSessionAuth, (req, res) => {
    const invites = all(
        `SELECT sm.squad_id, sm.invited_at, s.name, s.leader_username FROM squad_members sm
         JOIN squads s ON s.id = sm.squad_id
         WHERE lower(sm.username) = lower(?) AND sm.status = 'pending'
         ORDER BY sm.invited_at DESC`,
        [req.playerUsername]
    );
    res.json({ invites });
});

// ─── Squad erstellen ───────────────────────────────────────────────────────────
router.post('/create', playerSessionAuth, (req, res) => {
    try {
        if (getMySquad(req.playerUsername)) {
            return res.status(400).json({ error: 'Du bist bereits in einem Squad.' });
        }
        const { name } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: 'Name erforderlich.' });

        run(`INSERT INTO squads (name, leader_username) VALUES (?, ?)`, [name.trim().slice(0, 40), req.playerUsername]);
        const squad = get(`SELECT id FROM squads WHERE leader_username = ? ORDER BY id DESC LIMIT 1`, [req.playerUsername]);
        run(`INSERT INTO squad_members (squad_id, username, status, responded_at) VALUES (?, ?, 'accepted', strftime('%s','now'))`,
            [squad.id, req.playerUsername]);

        res.json({ success: true, squad: getMySquad(req.playerUsername) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Spieler-Suche für die Einladung ───────────────────────────────────────────
router.get('/search', playerSessionAuth, (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (q.length < 2) return res.json({ players: [] });

        const results = all(
            `SELECT username, display_name, avatar_url, level FROM players
             WHERE username LIKE ? AND lower(username) != lower(?)
             ORDER BY username ASC LIMIT 8`,
            ['%' + q + '%', req.playerUsername]
        );
        res.json({ players: results.map(p => ({ username: p.username, displayName: p.display_name || p.username, avatarUrl: p.avatar_url, level: p.level })) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Mitglied einladen (nur Leader) ────────────────────────────────────────────
router.post('/invite', playerSessionAuth, async (req, res) => {
    try {
        const squad = getMySquad(req.playerUsername);
        if (!squad) return res.status(400).json({ error: 'Du bist in keinem Squad.' });
        if (squad.leaderUsername.toLowerCase() !== req.playerUsername.toLowerCase()) {
            return res.status(403).json({ error: 'Nur der Squad-Leader kann einladen.' });
        }

        const { username } = req.body;
        if (!username) return res.status(400).json({ error: 'Username erforderlich.' });

        const activeOrPending = squad.members.filter(m => m.status === 'accepted' || m.status === 'pending');
        if (activeOrPending.length >= MAX_SQUAD_SIZE) {
            return res.status(400).json({ error: `Squad ist voll (max. ${MAX_SQUAD_SIZE} inkl. Leader).` });
        }
        if (squad.members.some(m => m.username.toLowerCase() === username.toLowerCase())) {
            return res.status(400).json({ error: 'Spieler ist schon eingeladen oder Mitglied.' });
        }

        const targetPlayer = get(`SELECT username FROM players WHERE lower(username) = lower(?)`, [username]);
        if (!targetPlayer) return res.status(404).json({ error: 'Spieler nicht gefunden — hat er schon mal !loot gespielt?' });

        run(`INSERT INTO squad_members (squad_id, username, status) VALUES (?, ?, 'pending')`, [squad.id, targetPlayer.username]);

        const { sendChatMessage } = require('../../utils/chatSender');
        const channel = '#' + (process.env.TWITCH_CHANNEL || '');
        const url = (process.env.PLAYER_HUB_URL || 'https://lootgamebot.de/player-login.html').replace('player-login.html', 'player-squad.html');
        sendChatMessage(channel, `📨 @${targetPlayer.username}, du wurdest ins Squad "${squad.name}" eingeladen! Bestätige hier: ${url}`).catch(() => {});

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Einladung annehmen/ablehnen ───────────────────────────────────────────────
router.post('/respond', playerSessionAuth, (req, res) => {
    try {
        const { squadId, accept } = req.body;
        const invite = get(
            `SELECT * FROM squad_members WHERE squad_id = ? AND lower(username) = lower(?) AND status = 'pending'`,
            [squadId, req.playerUsername]
        );
        if (!invite) return res.status(404).json({ error: 'Einladung nicht gefunden.' });

        if (!accept) {
            run(`DELETE FROM squad_members WHERE id = ?`, [invite.id]);
            return res.json({ success: true, accepted: false });
        }

        // Annehmen heißt: jede vorherige eigene Mitgliedschaft wird automatisch verlassen
        // (ein Spieler kann ja nur in einem Squad gleichzeitig aktiv sein).
        const currentSquad = getMySquad(req.playerUsername);
        if (currentSquad) {
            leaveOrDissolve(currentSquad, req.playerUsername);
        }

        run(`UPDATE squad_members SET status = 'accepted', responded_at = strftime('%s','now') WHERE id = ?`, [invite.id]);
        res.json({ success: true, accepted: true, squad: getMySquad(req.playerUsername) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Mitglied entfernen (nur Leader) ────────────────────────────────────────────
router.post('/kick', playerSessionAuth, (req, res) => {
    try {
        const squad = getMySquad(req.playerUsername);
        if (!squad) return res.status(400).json({ error: 'Du bist in keinem Squad.' });
        if (squad.leaderUsername.toLowerCase() !== req.playerUsername.toLowerCase()) {
            return res.status(403).json({ error: 'Nur der Squad-Leader kann Mitglieder entfernen.' });
        }
        const { username } = req.body;
        if (username.toLowerCase() === squad.leaderUsername.toLowerCase()) {
            return res.status(400).json({ error: 'Der Leader kann sich nicht selbst kicken — nutze "Squad verlassen".' });
        }
        run(`DELETE FROM squad_members WHERE squad_id = ? AND lower(username) = lower(?)`, [squad.id, username]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Squad verlassen (Leader: Übergabe oder Auflösung) ────────────────────────
function leaveOrDissolve(squad, username) {
    const isLeader = squad.leaderUsername.toLowerCase() === username.toLowerCase();
    run(`DELETE FROM squad_members WHERE squad_id = ? AND lower(username) = lower(?)`, [squad.id, username]);

    if (!isLeader) return;

    const remaining = all(
        `SELECT username FROM squad_members WHERE squad_id = ? AND status = 'accepted' ORDER BY invited_at ASC`,
        [squad.id]
    );
    if (remaining.length === 0) {
        run(`DELETE FROM squads WHERE id = ?`, [squad.id]);
    } else {
        run(`UPDATE squads SET leader_username = ? WHERE id = ?`, [remaining[0].username, squad.id]);
    }
}

router.post('/leave', playerSessionAuth, (req, res) => {
    try {
        const squad = getMySquad(req.playerUsername);
        if (!squad) return res.status(400).json({ error: 'Du bist in keinem Squad.' });
        leaveOrDissolve(squad, req.playerUsername);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Squad-Statistiken (gemeinsamer Stash, Raids zusammen, Überlebensrate) ───
router.get('/stats', playerSessionAuth, (req, res) => {
    try {
        const squad = getMySquad(req.playerUsername);
        if (!squad) return res.status(400).json({ error: 'Du bist in keinem Squad.' });

        const { getPlayer, getStashValue } = require('../../db/players');
        const accepted = squad.members.filter(m => m.status === 'accepted');
        const combinedStash = accepted.reduce((sum, m) => {
            const p = getPlayer(m.username);
            return sum + (p ? getStashValue(p.id) : 0);
        }, 0);

        const history = all(`SELECT survived FROM squad_raid_history WHERE squad_id = ?`, [squad.id]);
        const raidsTogether = history.length;
        const survivedTogether = history.filter(h => h.survived === 1).length;
        const survivalRate = raidsTogether > 0 ? Math.round((survivedTogether / raidsTogether) * 100) : 0;

        res.json({ combinedStash, raidsTogether, survivalRate });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Letzte gemeinsame Raids ──────────────────────────────────────────────────
router.get('/history', playerSessionAuth, (req, res) => {
    try {
        const squad = getMySquad(req.playerUsername);
        if (!squad) return res.status(400).json({ error: 'Du bist in keinem Squad.' });

        const rows = all(
            `SELECT map, survived, participants, resolved_at FROM squad_raid_history
             WHERE squad_id = ? ORDER BY resolved_at DESC LIMIT 15`,
            [squad.id]
        ).map(r => ({
            map: r.map,
            survived: r.survived === 1,
            participants: JSON.parse(r.participants || '[]'),
            resolvedAt: r.resolved_at
        }));
        res.json({ history: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Squad-Icon/Farbe anpassen (nur Leader) ───────────────────────────────────
const SQUAD_ICONS = ['🎯', '🔥', '⚔️', '🛡️', '💀', '⭐', '🐺', '🦅', '☠️', '🏆', '⚡', '🎲'];
const SQUAD_COLORS = ['#10b981', '#60a5fa', '#f59e0b', '#f472b6', '#a78bfa', '#f87171', '#22d3ee', '#94a3b8'];

router.post('/customize', playerSessionAuth, (req, res) => {
    try {
        const squad = getMySquad(req.playerUsername);
        if (!squad) return res.status(400).json({ error: 'Du bist in keinem Squad.' });
        if (squad.leaderUsername.toLowerCase() !== req.playerUsername.toLowerCase()) {
            return res.status(403).json({ error: 'Nur der Squad-Leader kann das Squad anpassen.' });
        }
        const { icon, color } = req.body;
        if (!SQUAD_ICONS.includes(icon) || !SQUAD_COLORS.includes(color)) {
            return res.status(400).json({ error: 'Ungültiges Icon oder Farbe.' });
        }
        run(`UPDATE squads SET icon = ?, color = ? WHERE id = ?`, [icon, color, squad.id]);
        res.json({ success: true, icon, color });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/options', playerSessionAuth, (req, res) => {
    res.json({ icons: SQUAD_ICONS, colors: SQUAD_COLORS });
});

module.exports = { router };
