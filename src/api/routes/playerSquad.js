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
        `SELECT sm.*, s.name, s.leader_username FROM squad_members sm
         JOIN squads s ON s.id = sm.squad_id
         WHERE lower(sm.username) = lower(?) AND sm.status = 'accepted'`,
        [username]
    );
    if (!membership) return null;

    const members = all(
        `SELECT sm.username, sm.status, sm.invited_at, p.display_name, p.avatar_url, p.level
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
        invited_at: m.invited_at
    }));

    return {
        id: membership.squad_id,
        name: membership.name,
        leaderUsername: membership.leader_username,
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
        const url = (process.env.PLAYER_HUB_URL || 'https://lootgamebot.fly.dev/player-login.html').replace('player-login.html', 'player-squad.html');
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

module.exports = { router };
