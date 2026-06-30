/**
 * Löst fällige Raids auf — ersetzt das frühere in-memory setTimeout in loot.js.
 * Läuft periodisch (siehe index.js) und überlebt dadurch Bot-Neustarts: Raids,
 * die während eines Deploys/Restarts fällig wurden, werden beim nächsten Tick
 * einfach nachträglich aufgelöst statt spurlos zu verschwinden.
 *
 * Seit Schritt 2 der Squad-Mechanik: Zeilen mit der gleichen squad_window_id
 * gehören zu EINEM gemeinsamen Raid (ein Würfelwurf für die Gruppe) und werden
 * zu einer einzigen Sammel-Nachricht zusammengefasst statt einzeln gesendet.
 */
const { all, run } = require('../db/schema');
const { updatePlayer, addOrUpdateInventoryItem, setCooldown, getStashValue, getPlayer } = require('../db/players');
const { getConfig, setConfig, getLeveling } = require('../db/config');
const { getRankName } = require('../utils/format');
const { getMapEmoji } = require('../engine/loot');
const { formatNameList } = require('./squadRaid');
const { logCommand } = require('../utils/analytics');
const logger = require('../utils/logger');

async function resolvePendingRaids(sayFn) {
    let due;
    try {
        due = all(`SELECT * FROM pending_raids WHERE resolve_at <= strftime('%s','now') ORDER BY resolve_at ASC`);
    } catch (err) {
        logger.error('RAID-RESOLVER', 'Konnte pending_raids nicht lesen: ' + err.message);
        return;
    }
    if (!due.length) return;

    // Gruppieren: gleiche squad_window_id gehört zusammen, alles andere bleibt solo
    const groups = new Map();
    for (const raid of due) {
        const key = raid.squad_window_id != null ? 'squad-' + raid.squad_window_id : 'solo-' + raid.id;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(raid);
    }

    for (const rows of groups.values()) {
        try {
            await resolveGroup(rows, sayFn);
        } catch (err) {
            logger.error('RAID-RESOLVER', `Fehler beim Auflösen einer Gruppe (${rows.map(r => r.username).join(', ')}): ${err.message}`);
        } finally {
            for (const r of rows) run(`DELETE FROM pending_raids WHERE id = ?`, [r.id]);
        }
    }
}

async function resolveGroup(rows, sayFn) {
    // Stats/Inventar/XP werden IMMER pro Zeile einzeln angewendet — nur die
    // Chat-Nachricht wird bei Gruppen zusammengefasst.
    const outcomes = rows.map(applyOutcome);

    if (rows.length === 1) {
        await sayFn(rows[0].channel, buildSoloMessage(outcomes[0]));
        return;
    }

    // Echter Gruppen-Raid (2+ Teilnehmer) -> in die gemeinsame Historie eintragen
    let squadIcon = null;
    if (rows[0].squad_window_id != null) {
        try {
            const window = require('../db/schema').get(`SELECT squad_id FROM squad_raid_windows WHERE id = ?`, [rows[0].squad_window_id]);
            if (window) {
                const squadRow = require('../db/schema').get(`SELECT icon FROM squads WHERE id = ?`, [window.squad_id]);
                squadIcon = squadRow?.icon || null;
                run(
                    `INSERT INTO squad_raid_history (squad_id, map, survived, participants) VALUES (?, ?, ?, ?)`,
                    [window.squad_id, rows[0].map, outcomes[0].survived ? 1 : 0, JSON.stringify(outcomes.map(o => o.username))]
                );
            }
        } catch (err) {
            logger.error('RAID-RESOLVER', 'Konnte Squad-Raid-Historie nicht speichern: ' + err.message);
        }
    }

    await sayFn(rows[0].channel, buildGroupMessage(outcomes, rows[0].map, squadIcon));
}

// ─── Stats anwenden, OHNE eine Nachricht zu senden ───────────────────────────
function applyOutcome(raid) {
    const { player_id, username, map, xp_gain, old_level, new_level } = raid;
    const survived = raid.survived === 1;

    setCooldown(player_id, 'loot', 0); // sofort wieder looten möglich

    if (!survived) {
        updatePlayerRaidCounts(username, true);
        logCommand('!loot', username, raid.channel, { map, survived: false });
        try {
            require('../utils/wsHub').broadcast({ type: 'raid_result', username, survived: false, map });
        } catch (_) {}
        return { username, map, survived: false };
    }

    const loot = JSON.parse(raid.loot_json || '[]');
    for (const item of loot) {
        addOrUpdateInventoryItem(player_id, item.displayName, 1, item.value || 0, item.key);
    }

    applyXpAndLevel(username, xp_gain, new_level);
    updatePlayerRaidCounts(username, false);

    checkTopLooterPush(player_id, username);

    const mainItem = loot[0];
    logCommand('!loot', username, raid.channel, {
        map, survived: true,
        itemName: mainItem?.displayName, itemValue: mainItem?.value || 0, xpGain: xp_gain
    });

    try {
        require('../utils/wsHub').broadcast({
            type: 'raid_result', username, survived: true, map,
            value: mainItem?.value || 0, itemName: mainItem?.displayName || null,
            leveledUp: new_level > old_level, newLevel: new_level
        });
    } catch (_) {}

    return { username, map, survived: true, loot, xpGain: xp_gain, leveledUp: new_level > old_level, newLevel: new_level };
}

function checkTopLooterPush(playerId, username) {
    try {
        const newStashValue = getStashValue(playerId);
        const record = getConfig('TopLooterRecord') || { username: null, value: 0 };
        if (newStashValue > record.value && record.username?.toLowerCase() !== username.toLowerCase()) {
            setConfig('TopLooterRecord', { username, value: newStashValue });
            const { sendPushToAll } = require('../utils/push');
            sendPushToAll({
                title: '🏆 Neuer Top-Looter!',
                body: `${username} ist jetzt #1 mit ${newStashValue.toLocaleString('de-DE')} ₽ Stash-Wert.`,
                url: '/admin.html'
            }).catch(() => {});
        } else if (newStashValue > record.value) {
            setConfig('TopLooterRecord', { username, value: newStashValue });
        }
    } catch (err) {
        logger.error('RAID-RESOLVER', 'Top-Looter-Push-Check fehlgeschlagen: ' + err.message);
    }
}

// ─── Einzel-Nachricht (Solo-Raid, exakt wie bisher) ──────────────────────────
function buildSoloMessage(o) {
    const { formatLootMsg, formatDeathMsg } = require('../engine/loot');
    if (!o.survived) return formatDeathMsg(o.username, o.map);

    const lootForMsg = o.loot.map(i => ({ item: { text: i.displayName, value: i.value, name: i.key }, map: o.map }));
    let msg = formatLootMsg(o.username, lootForMsg, false);
    if (o.leveledUp) {
        const rankName = getRankName(o.newLevel, getLeveling().Ranks);
        msg += ` 🎉 LEVEL UP! @${o.username} ist nun Level ${o.newLevel} — ${rankName}!`;
    } else {
        msg += ` ✨ (+${o.xpGain} XP)`;
    }
    return msg;
}

// ─── Sammel-Nachricht für einen gemeinsamen Squad-Raid ───────────────────────
function buildGroupMessage(outcomes, map, squadIcon) {
    const emoji = squadIcon || getMapEmoji(map);
    const names = outcomes.map(o => o.username);

    if (!outcomes[0].survived) {
        return `${emoji} 💀 ${formatNameList(names)} sind gemeinsam auf ${map} verreckt. Pech gehabt zusammen!`;
    }

    const fragments = outcomes.map(o => {
        if (!o.loot.length) return `@${o.username} mit nichts Brauchbares`;
        const itemsPart = o.loot.map(i => `${i.displayName} [${formatShort(i.value)}]`).join(' & ');
        const doubleTag = o.loot.length > 1 ? ' 🔥' : '';
        return `@${o.username}${doubleTag} mit ${itemsPart} (+${o.xpGain} XP)`;
    });

    const levelUps = outcomes.filter(o => o.leveledUp);
    let msg = `${emoji} ${formatNameList(names)} entkommen gemeinsam von ${map}! ${fragments.join(', ')}.`;
    if (levelUps.length) {
        const leveling = getLeveling();
        msg += ' 🎉 ' + levelUps.map(o => `@${o.username} ist nun Level ${o.newLevel} — ${getRankName(o.newLevel, leveling.Ranks)}!`).join(' ');
    }
    return msg;
}

function formatShort(v) {
    if (!v) return '0 ₽';
    if (v >= 1e6) return (v/1e6).toFixed(1) + 'M ₽';
    if (v >= 1e3) return (v/1e3).toFixed(0) + 'K ₽';
    return v + ' ₽';
}

function updatePlayerRaidCounts(username, died) {
    const p = getPlayer(username);
    if (!p) return;
    updatePlayer(username, {
        raids_total:    (p.raids_total    || 0) + 1,
        raids_survived: (p.raids_survived || 0) + (died ? 0 : 1),
        raids_died:     (p.raids_died     || 0) + (died ? 1 : 0)
    });
}

function applyXpAndLevel(username, xpGain, newLevel) {
    const p = getPlayer(username);
    if (!p) return;
    const newXP = (p.xp || 0) + xpGain;
    updatePlayer(username, {
        xp:    Math.max(0, newXP),
        level: Math.max(1, newLevel)
    });
}

module.exports = { resolvePendingRaids };