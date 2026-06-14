const { getOrCreatePlayer, updatePlayer, addOrUpdateInventoryItem,
        isOnCooldown, setCooldown, getRemainingCooldown } = require('../db/players');
const { getGeneral, getActiveEvents, getLeveling } = require('../db/config');
const { generateLoot, calculateXPGain,
        formatInfiltrationMsg, formatLootMsg, formatDeathMsg } = require('../engine/loot');
const { calcLevelFromXP, calcXPForLevel, getRankName, formatDuration } = require('../utils/format');

const COMMAND = '!loot';

async function handler({ client, channel, user }) {
    const general  = getGeneral();
    const cooldown = general.CooldownSeconds || 600;

    // Spieler laden / anlegen
    const player = await getOrCreatePlayer(user);

    // Cooldown prüfen
    const remaining = getRemainingCooldown(player.id, 'loot');
    if (remaining > 0) {
        const delay = general.CooldownMessageDelaySeconds || 0;
        setTimeout(() => {
            client.say(channel,
                `⏳ @${user}, du bist noch im Cooldown! Warte noch ${formatDuration(remaining)}.`
            );
        }, delay * 1000);
        return;
    }

    // Cooldown setzen
    setCooldown(player.id, 'loot', cooldown);

    // Loot generieren
    const loot = generateLoot(player.has_kappa === 1);
    if (!loot) {
        client.say(channel, `⚠️ @${user}, keine Items in der Datenbank gefunden.`);
        return;
    }

    const map = loot[0].map;

    // Erste Nachricht — nur Infiltration
    client.say(channel, formatInfiltrationMsg(user, map));

    // Exfil-Zeit berechnen
    const minExfil = general.MinExfilSeconds || 5;
    const maxExfil = general.MaxExfilSeconds || 15;
    const exfilTime = Math.floor(Math.random() * (maxExfil - minExfil + 1)) + minExfil;

    // Nach Exfil-Zeit: überleben oder sterben
    setTimeout(async () => {
        try {
            const survivalChance = general.SurvivalChance || 0.75;
            const survived = Math.random() <= survivalChance;

            // Raid-Stats aktualisieren
            const raidsTotal    = (player.raids_total    || 0) + 1;
            const raidsSurvived = (player.raids_survived  || 0) + (survived ? 1 : 0);
            const raidsDied     = (player.raids_died      || 0) + (survived ? 0 : 1);

            if (!survived) {
                updatePlayer(user, { raids_total: raidsTotal, raids_died: raidsDied });
                client.say(channel, formatDeathMsg(user, map));
                return;
            }

            // Items ins Inventar
            for (const { item } of loot) {
                const itemName = item.text || item.name || 'Unbekanntes Item';
                addOrUpdateInventoryItem(player.id, itemName, 1, item.value || 0);
            }

            // XP berechnen
            const events      = getActiveEvents();
            const now         = Math.floor(Date.now() / 1000);
            const leveling    = getLeveling();
            let xpMultiplier  = 1;

            if (events.XPBoost && events.XPBoost.Multiplier > 1 &&
                events.XPBoost.ExpiresAt > now) {
                xpMultiplier = events.XPBoost.Multiplier;
            }

            const totalItemValue = loot.reduce((sum, { item }) => sum + (item.value || 0), 0);
            const xpGain = Math.floor(calculateXPGain(totalItemValue, player.prestige) * xpMultiplier);
            const newXP  = (player.xp || 0) + xpGain;

            // Level berechnen
            const oldLevel = player.level || 1;
            const newLevel = calcLevelFromXP(newXP, leveling);

            updatePlayer(user, {
                xp:             Math.max(0, newXP || 0),
                level:          Math.max(1, newLevel || 1),
                raids_total:    raidsTotal,
                raids_survived: raidsSurvived,
                raids_died:     raidsDied
            });

            // Loot-Nachricht + XP
            let lootMsg = formatLootMsg(user, loot, player.has_kappa === 1);
            if (newLevel > oldLevel) {
                const rankName = getRankName(newLevel, leveling.Ranks);
                lootMsg += ` 🎉 LEVEL UP! @${user} ist nun Level ${newLevel} — ${rankName}!`;
            } else {
                lootMsg += ` ✨ (+${xpGain} XP)`;
            }
            client.say(channel, lootMsg);
        } catch (err) {
            console.error(`[LOOT] Fehler im Exfil-Timer für ${user}:`, err.message);
            client.say(channel, `❌ @${user}, beim Exfil ist etwas schiefgelaufen!`);
        }

    }, exfilTime * 1000);
}

module.exports = { command: COMMAND, handler };