const { getOrCreatePlayer, updatePlayer, addOrUpdateInventoryItem,
        setCooldown, getRemainingCooldown } = require('../db/players');
const { getGeneral, getActiveEvents, getLeveling } = require('../db/config');
const { generateLoot, calculateXPGain,
        formatInfiltrationMsg, formatLootMsg, formatDeathMsg } = require('../engine/loot');
const { calcLevelFromXP, getRankName, formatDuration } = require('../utils/format');
const { logCommand } = require('../utils/analytics');
const logger = require('../utils/logger');

const COMMAND = '!loot';

async function handler({ client, channel, user }) {
    const general = getGeneral();

    // Spieler laden / anlegen
    const player = await getOrCreatePlayer(user);

    // Cooldown prüfen — ist Spieler noch im Raid?
    const remaining = getRemainingCooldown(player.id, 'loot');
    if (remaining > 0) {
        const delay = general.CooldownMessageDelaySeconds || 0;
        setTimeout(() => {
            client.say(channel, `⏳ @${user}, dein Raid läuft noch ${formatDuration(remaining)}.`);
        }, delay * 1000);
        return;
    }

    // Loot generieren
    const loot = generateLoot(player.has_kappa === 1);
    if (!loot) {
        client.say(channel, `⚠️ @${user}, keine Items in der Datenbank gefunden.`);
        return;
    }

    const map = loot[0].map;

    // Exfil-Zeit berechnen
    const minExfil  = general.MinExfilSeconds || 5;
    const maxExfil  = general.MaxExfilSeconds || 15;
    const exfilTime = Math.floor(Math.random() * (maxExfil - minExfil + 1)) + minExfil;

    // Cooldown = Exfil-Zeit → Spieler ist "im Raid"
    setCooldown(player.id, 'loot', exfilTime + 1);

    // Infiltrations-Nachricht
    client.say(channel, formatInfiltrationMsg(user, map));

    // Nach Exfil-Zeit: Ergebnis
    setTimeout(async () => {
        try {
            const survivalChance = general.SurvivalChance || 0.75;
            const survived = Math.random() <= survivalChance;

            const raidsTotal    = (player.raids_total    || 0) + 1;
            const raidsSurvived = (player.raids_survived || 0) + (survived ? 1 : 0);
            const raidsDied     = (player.raids_died     || 0) + (survived ? 0 : 1);

            if (!survived) {
                updatePlayer(user, { raids_total: raidsTotal, raids_died: raidsDied });
                setCooldown(player.id, 'loot', 0);
                logCommand('!loot', user, channel, { map, survived: false });
                client.say(channel, formatDeathMsg(user, map));
                return;
            }

            // Items ins Inventar
            for (const { item } of loot) {
                const itemName = item.text || item.name;
                addOrUpdateInventoryItem(player.id, itemName, 1, item.value || 0, item.name);
            }

            // XP berechnen
            const events     = getActiveEvents();
            const now        = Math.floor(Date.now() / 1000);
            const leveling   = getLeveling();
            let xpMultiplier = 1;

            if (events.XPBoost?.Multiplier > 1 && events.XPBoost?.ExpiresAt > now) {
                xpMultiplier = events.XPBoost.Multiplier;
            }

            const totalItemValue = loot.reduce((sum, { item }) => sum + (item.value || 0), 0);
            const xpGain  = Math.floor(calculateXPGain(totalItemValue, player.prestige) * xpMultiplier);
            const newXP   = (player.xp || 0) + xpGain;
            const oldLevel = player.level || 1;
            const newLevel = calcLevelFromXP(newXP, leveling);

            updatePlayer(user, {
                xp:             Math.max(0, newXP),
                level:          Math.max(1, newLevel),
                raids_total:    raidsTotal,
                raids_survived: raidsSurvived,
                raids_died:     raidsDied
            });

            // Cooldown löschen — sofort wieder looten möglich
            setCooldown(player.id, 'loot', 0);

            // Analytics
            const mainItem = loot[0]?.item;
            logCommand('!loot', user, channel, {
                map,
                survived:  true,
                itemName:  mainItem?.text || mainItem?.name,
                itemValue: mainItem?.value || 0,
                xpGain
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
            logger.error('LOOT', `Fehler im Exfil-Timer für ${user}: ${err.message}`);
            setCooldown(player.id, 'loot', 0);
            client.say(channel, `❌ @${user}, beim Exfil ist etwas schiefgelaufen!`);
        }
    }, exfilTime * 1000);
}

module.exports = { command: COMMAND, handler };
