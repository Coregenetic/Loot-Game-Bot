const { getOrCreatePlayer, setCooldown, getRemainingCooldown } = require('../db/players');
const { getGeneral } = require('../db/config');
const { run } = require('../db/schema');
const { generateLoot, selectMap, computePlayerOutcome, formatInfiltrationMsg } = require('../engine/loot');
const { formatDuration } = require('../utils/format');
const { tryJoinSquadWindow } = require('../engine/squadRaid');

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

    // Squad-Check: ist der Spieler in einem angenommenen Squad? Falls ja, läuft
    // alles über das 15-Sekunden-Fenster (engine/squadRaid.js) statt hier weiter —
    // das eigentliche Ergebnis kommt dann über den periodischen Resolver.
    const sayFn = (ch, msg) => client.say(ch, msg);
    const handledBySquad = await tryJoinSquadWindow(player, user, channel, sayFn);
    if (handledBySquad) return;

    // ─── Ab hier: ganz normaler Solo-Raid, wie bisher ──────────────────────────
    const map = selectMap();

    const minExfil  = general.MinExfilSeconds || 5;
    const maxExfil  = general.MaxExfilSeconds || 15;
    const exfilTime = Math.floor(Math.random() * (maxExfil - minExfil + 1)) + minExfil;

    const survivalChance = general.SurvivalChance ?? 0.75;
    const survived = Math.random() <= survivalChance;

    const { lootPayload, xpGain, oldLevel, newLevel } = computePlayerOutcome(player, survived, map);
    if (survived && !lootPayload.length) {
        client.say(channel, `⚠️ @${user}, keine Items in der Datenbank gefunden.`);
        return;
    }

    setCooldown(player.id, 'loot', exfilTime + 1);
    client.say(channel, formatInfiltrationMsg(user, map));

    const resolveAt = Math.floor(Date.now() / 1000) + exfilTime;
    run(
        `INSERT INTO pending_raids (player_id, username, channel, map, survived, loot_json, xp_gain, old_level, new_level, has_kappa, resolve_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [player.id, user, channel, map, survived ? 1 : 0, JSON.stringify(lootPayload), xpGain, oldLevel, newLevel, player.has_kappa === 1 ? 1 : 0, resolveAt]
    );
}

module.exports = { command: COMMAND, handler };