/**
 * Löst fällige Raids auf — ersetzt das frühere in-memory setTimeout in loot.js.
 * Läuft periodisch (siehe index.js) und überlebt dadurch Bot-Neustarts: Raids,
 * die während eines Deploys/Restarts fällig wurden, werden beim nächsten Tick
 * einfach nachträglich aufgelöst statt spurlos zu verschwinden.
 */
const { all, run } = require('../db/schema');
const { updatePlayer, addOrUpdateInventoryItem, setCooldown, getStashValue } = require('../db/players');
const { getConfig, setConfig } = require('../db/config');
const { getRankName } = require('../utils/format');
const { getLeveling } = require('../db/config');
const { formatLootMsg, formatDeathMsg } = require('../engine/loot');
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

    for (const raid of due) {
        try {
            await resolveOne(raid, sayFn);
        } catch (err) {
            logger.error('RAID-RESOLVER', `Fehler beim Auflösen von Raid #${raid.id} (${raid.username}): ${err.message}`);
        } finally {
            // Egal ob Erfolg oder Fehler — die Zeile wird entfernt, damit nicht
            // endlos derselbe kaputte Raid neu versucht wird.
            run(`DELETE FROM pending_raids WHERE id = ?`, [raid.id]);
        }
    }
}

async function resolveOne(raid, sayFn) {
    const { player_id, username, channel, map, xp_gain, old_level, new_level } = raid;
    const survived = raid.survived === 1;

    // Cooldown in jedem Fall lösen — sofort wieder looten möglich
    setCooldown(player_id, 'loot', 0);

    if (!survived) {
        updatePlayerRaidCounts(username, true);
        logCommand('!loot', username, channel, { map, survived: false });
        await sayFn(channel, formatDeathMsg(username, map));
        return;
    }

    const loot = JSON.parse(raid.loot_json || '[]');

    // Items ins Inventar
    for (const item of loot) {
        addOrUpdateInventoryItem(player_id, item.displayName, 1, item.value || 0, item.key);
    }

    // XP + Level anwenden
    applyXpAndLevel(username, xp_gain, new_level);
    updatePlayerRaidCounts(username, false);

    // Neuer Top-Looter? -> Push-Benachrichtigung an alle Dashboard-User
    try {
        const newStashValue = getStashValue(player_id);
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

    // Analytics — Hauptitem ist das erste in der Liste
    const mainItem = loot[0];
    logCommand('!loot', username, channel, {
        map,
        survived: true,
        itemName: mainItem?.displayName,
        itemValue: mainItem?.value || 0,
        xpGain: xp_gain
    });

    // Loot-Nachricht + XP
    const lootForMsg = loot.map(i => ({ item: { text: i.displayName, value: i.value, name: i.key }, map }));
    let lootMsg = formatLootMsg(username, lootForMsg, raid.has_kappa === 1);

    if (new_level > old_level) {
        const leveling  = getLeveling();
        const rankName  = getRankName(new_level, leveling.Ranks);
        lootMsg += ` 🎉 LEVEL UP! @${username} ist nun Level ${new_level} — ${rankName}!`;
    } else {
        lootMsg += ` ✨ (+${xp_gain} XP)`;
    }

    await sayFn(channel, lootMsg);
}

function updatePlayerRaidCounts(username, died) {
    const { getPlayer } = require('../db/players');
    const p = getPlayer(username);
    if (!p) return;
    updatePlayer(username, {
        raids_total:    (p.raids_total    || 0) + 1,
        raids_survived: (p.raids_survived || 0) + (died ? 0 : 1),
        raids_died:     (p.raids_died     || 0) + (died ? 1 : 0)
    });
}

function applyXpAndLevel(username, xpGain, newLevel) {
    const { getPlayer } = require('../db/players');
    const p = getPlayer(username);
    if (!p) return;
    const newXP = (p.xp || 0) + xpGain;
    updatePlayer(username, {
        xp:    Math.max(0, newXP),
        level: Math.max(1, newLevel)
    });
}

module.exports = { resolvePendingRaids };