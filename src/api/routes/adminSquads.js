/**
 * Admin-Verwaltung für Squads — Übersicht aller Squads/Mitglieder, plus
 * einstellbare Gameplay-Overrides pro Squad (z.B. besserer Loot-Wert,
 * kürzere Raid-Zeit), ohne dass dafür neuer Code geschrieben werden muss.
 */
const express = require('express');
const router  = express.Router();
const { all, get, run } = require('../../db/schema');
const { requirePermission } = require('../middleware/permission');
const { logAudit } = require('../../db/audit');

// Welche Felder dürfen pro Squad überschrieben werden — exakt die gleichen
// Namen wie in der globalen General-Config, plus ValueMultiplier (gibt's
// global nicht, skaliert nur innerhalb von Squad-Raids den Loot-Wert).
const OVERRIDABLE_FIELDS = [
    'MinExfilSeconds', 'MaxExfilSeconds', 'SurvivalChance',
    'DoubleLootChance', 'KappaDoubleLootBonus', 'ValueMultiplier'
];

router.get('/', requirePermission('squads:manage'), (req, res) => {
    try {
        const squads = all(`SELECT * FROM squads ORDER BY created_at DESC`);
        const result = squads.map(s => {
            const members = all(
                `SELECT sm.username, sm.status, p.display_name, p.avatar_url, p.level
                 FROM squad_members sm
                 LEFT JOIN players p ON lower(p.username) = lower(sm.username)
                 WHERE sm.squad_id = ? ORDER BY sm.invited_at ASC`,
                [s.id]
            );
            let overrides = {};
            try { overrides = s.config_overrides ? JSON.parse(s.config_overrides) : {}; } catch {}
            return {
                id: s.id,
                name: s.name,
                leaderUsername: s.leader_username,
                createdAt: s.created_at,
                overrides,
                members: members.map(m => ({
                    username: m.username, status: m.status,
                    displayName: m.display_name || m.username, avatarUrl: m.avatar_url, level: m.level || 1
                }))
            };
        });
        res.json({ squads: result, overridableFields: OVERRIDABLE_FIELDS });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id/config', requirePermission('squads:manage'), (req, res) => {
    try {
        const squad = get(`SELECT id FROM squads WHERE id = ?`, [req.params.id]);
        if (!squad) return res.status(404).json({ error: 'Squad nicht gefunden.' });

        const body = req.body || {};
        const cleaned = {};
        for (const key of OVERRIDABLE_FIELDS) {
            if (body[key] === undefined || body[key] === null || body[key] === '') continue; // nicht gesetzt -> globaler Wert gilt
            const num = Number(body[key]);
            if (Number.isNaN(num)) return res.status(400).json({ error: `Ungültiger Wert für ${key}` });
            cleaned[key] = num;
        }

        run(`UPDATE squads SET config_overrides = ? WHERE id = ?`, [JSON.stringify(cleaned), req.params.id]);
        logAudit(req.session.username, 'squad_config_update', { squadId: req.params.id, overrides: cleaned });
        res.json({ success: true, overrides: cleaned });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', requirePermission('squads:manage'), (req, res) => {
    try {
        const squad = get(`SELECT id, name FROM squads WHERE id = ?`, [req.params.id]);
        if (!squad) return res.status(404).json({ error: 'Squad nicht gefunden.' });
        run(`DELETE FROM squads WHERE id = ?`, [req.params.id]); // squad_members per ON DELETE CASCADE
        logAudit(req.session.username, 'squad_disband', { squadId: req.params.id, name: squad.name });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;