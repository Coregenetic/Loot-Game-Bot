/**
 * Squad-Raid-Mechanik (Schritt 2) — das 15-Sekunden-Fenster und die
 * gemeinsame Auflösung. Die Verwaltung (Squad erstellen/einladen/etc.) lebt
 * in src/api/routes/playerSquad.js, hier geht's nur um den eigentlichen Raid.
 */
const { run, get, all } = require('../db/schema');
const { getPlayer, setCooldown } = require('../db/players');
const { getGeneral } = require('../db/config');
const { selectMap, computePlayerOutcome, getMapEmoji, formatInfiltrationMsg } = require('./loot');
const logger = require('../utils/logger');

const SQUAD_WINDOW_SECONDS = 15;

// ─── Wird aus commands/loot.js aufgerufen, BEVOR der normale Solo-Pfad greift ──
// Gibt true zurück, wenn der Aufruf über den Squad-Pfad behandelt wurde
// (Spieler wartet jetzt im Fenster) — false, wenn ganz normal solo weitergemacht
// werden soll (kein Squad).
async function tryJoinSquadWindow(player, username, channel, sayFn) {
    const membership = get(
        `SELECT sm.squad_id, s.name FROM squad_members sm
         JOIN squads s ON s.id = sm.squad_id
         WHERE lower(sm.username) = lower(?) AND sm.status = 'accepted'`,
        [username]
    );
    if (!membership) return false; // kein Squad -> normaler Solo-Pfad

    let window = get(
        `SELECT * FROM squad_raid_windows WHERE squad_id = ? AND resolved = 0 AND closes_at > strftime('%s','now') ORDER BY id DESC LIMIT 1`,
        [membership.squad_id]
    );

    if (window) {
        const already = get(
            `SELECT 1 FROM squad_raid_participants WHERE window_id = ? AND lower(username) = lower(?)`,
            [window.id, username]
        );
        if (already) return true; // hat schon getriggert, ignorieren (kein Spam)
    }

    const isNewWindow = !window;
    if (isNewWindow) {
        const now = Math.floor(Date.now() / 1000);
        run(`INSERT INTO squad_raid_windows (squad_id, channel, opens_at, closes_at) VALUES (?, ?, ?, ?)`,
            [membership.squad_id, channel, now, now + SQUAD_WINDOW_SECONDS]);
        window = get(`SELECT * FROM squad_raid_windows WHERE squad_id = ? ORDER BY id DESC LIMIT 1`, [membership.squad_id]);
    }

    run(`INSERT INTO squad_raid_participants (window_id, player_id, username) VALUES (?, ?, ?)`,
        [window.id, player.id, username]);

    // Bewusst KEINE Nachricht beim Öffnen des Fensters — sonst hätte ein Squad-Raid
    // 3 Chat-Nachrichten (Warten/Start/Ergebnis) statt 2 wie ein Solo-Raid. Das
    // Fenster läuft im Hintergrund, die erste sichtbare Nachricht kommt erst
    // beim Auflösen (siehe resolveOneWindow), genau wie bei Solo-Raids.

    return true;
}

function formatNameList(usernames) {
    const names = usernames.map(u => '@' + u);
    if (names.length === 1) return names[0];
    return names.slice(0, -1).join(', ') + ' und ' + names[names.length - 1];
}

// ─── Periodisch aufgerufen (gleicher Takt wie der normale Raid-Resolver) ──────
async function resolveSquadWindows(sayFn) {
    let due;
    try {
        due = all(`SELECT * FROM squad_raid_windows WHERE resolved = 0 AND closes_at <= strftime('%s','now')`);
    } catch (err) {
        logger.error('SQUAD-RAID', 'Konnte squad_raid_windows nicht lesen: ' + err.message);
        return;
    }

    for (const window of due) {
        try {
            await resolveOneWindow(window, sayFn);
        } catch (err) {
            logger.error('SQUAD-RAID', `Fehler beim Auflösen von Fenster #${window.id}: ${err.message}`);
        } finally {
            run(`UPDATE squad_raid_windows SET resolved = 1 WHERE id = ?`, [window.id]);
        }
    }
}

async function resolveOneWindow(window, sayFn) {
    const participants = all(`SELECT * FROM squad_raid_participants WHERE window_id = ?`, [window.id]);
    if (!participants.length) return;

    // Per-Squad-Overrides (Admin Panel) auf die globale Config legen — fehlt
    // ein Feld, gilt einfach der globale Wert. ValueMultiplier ist kein
    // normales Config-Feld, wird separat behandelt (skaliert den Loot-Wert).
    const squadRow = get(`SELECT config_overrides FROM squads WHERE id = ?`, [window.squad_id]);
    let overrides = {};
    try { overrides = squadRow?.config_overrides ? JSON.parse(squadRow.config_overrides) : {}; } catch { overrides = {}; }
    const valueMultiplier = overrides.ValueMultiplier ?? 1;

    const general   = { ...getGeneral(), ...overrides };
    const minExfil  = general.MinExfilSeconds || 5;
    const maxExfil  = general.MaxExfilSeconds || 15;
    const exfilTime = Math.floor(Math.random() * (maxExfil - minExfil + 1)) + minExfil;
    const resolveAt = Math.floor(Date.now() / 1000) + exfilTime;

    const map = selectMap();
    const survivalChance = general.SurvivalChance ?? 0.75;
    const survived = Math.random() <= survivalChance; // EIN Wurf für die ganze Gruppe

    const usernames = [];
    for (const p of participants) {
        const player = getPlayer(p.username);
        if (!player) continue;

        setCooldown(player.id, 'loot', exfilTime + 1);

        const { lootPayload, xpGain, oldLevel, newLevel } = computePlayerOutcome(player, survived, map, general, valueMultiplier);

        run(
            `INSERT INTO pending_raids (player_id, username, channel, map, survived, loot_json, xp_gain, old_level, new_level, has_kappa, squad_window_id, resolve_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [player.id, p.username, window.channel, map, survived ? 1 : 0, JSON.stringify(lootPayload), xpGain, oldLevel, newLevel, player.has_kappa === 1 ? 1 : 0, window.id, resolveAt]
        );
        usernames.push(p.username);
    }

    if (!usernames.length) return;

    const squadInfo = get(`SELECT icon FROM squads WHERE id = ?`, [window.squad_id]);
    const emoji = usernames.length === 1 ? getMapEmoji(map) : (squadInfo?.icon || getMapEmoji(map));
    const msg = usernames.length === 1
        ? formatInfiltrationMsg(usernames[0], map) // nur 1 Teilnehmer -> ganz normale Solo-Ansage
        : `${emoji} ${formatNameList(usernames)} starten gemeinsam einen Raid auf ${map}...`;
    await sayFn(window.channel, msg);
}

module.exports = { tryJoinSquadWindow, resolveSquadWindows, formatNameList };