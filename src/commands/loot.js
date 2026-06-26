const { getOrCreatePlayer, setCooldown, getRemainingCooldown } = require('../db/players');
const { getGeneral, getActiveEvents, getLeveling } = require('../db/config');
const { run } = require('../db/schema');
const { generateLoot, calculateXPGain, formatInfiltrationMsg } = require('../engine/loot');
const { calcLevelFromXP, formatDuration } = require('../utils/format');

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

    // ─── Das komplette Ergebnis steht JETZT fest, nicht erst nach der Exfil-Zeit ───
    // Dadurch überlebt der Raid einen Bot-Neustart in der Zwischenzeit problemlos —
    // die eigentliche Auflösung (Nachricht senden, Stats anwenden) übernimmt der
    // periodische Resolver in engine/raidResolver.js anhand der DB.
    const survivalChance = general.SurvivalChance ?? 0.75;
    const survived = Math.random() <= survivalChance;

    let lootPayload = [];
    let xpGain = 0;
    let oldLevel = player.level || 1;
    let newLevel = oldLevel;

    if (survived) {
        lootPayload = loot.map(({ item }) => ({
            displayName: item.text || item.name,
            value: item.value || 0,
            key: item.name
        }));

        const events     = getActiveEvents();
        const now         = Math.floor(Date.now() / 1000);
        const leveling    = getLeveling();
        let xpMultiplier  = 1;
        if (events.XPBoost?.Multiplier > 1 && events.XPBoost?.ExpiresAt > now) {
            xpMultiplier = events.XPBoost.Multiplier;
        }

        const totalItemValue = loot.reduce((sum, { item }) => sum + (item.value || 0), 0);
        xpGain   = Math.floor(calculateXPGain(totalItemValue, player.prestige) * xpMultiplier);
        newLevel = calcLevelFromXP((player.xp || 0) + xpGain, leveling);
    }

    // Cooldown = Exfil-Zeit → Spieler ist "im Raid"
    setCooldown(player.id, 'loot', exfilTime + 1);

    // Infiltrations-Nachricht
    client.say(channel, formatInfiltrationMsg(user, map));

    // Ergebnis in der DB hinterlegen, statt in einem setTimeout zu "verstecken"
    const resolveAt = Math.floor(Date.now() / 1000) + exfilTime;
    run(
        `INSERT INTO pending_raids (player_id, username, channel, map, survived, loot_json, xp_gain, old_level, new_level, has_kappa, resolve_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [player.id, user, channel, map, survived ? 1 : 0, JSON.stringify(lootPayload), xpGain, oldLevel, newLevel, player.has_kappa === 1 ? 1 : 0, resolveAt]
    );
}

module.exports = { command: COMMAND, handler };