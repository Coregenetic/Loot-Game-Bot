const { getOrCreatePlayer, updatePlayer, clearInventory, getStashValue } = require('../db/players');
const { getLeveling } = require('../db/config');
const { calcXPForLevel, formatCurrency } = require('../utils/format');

const COMMAND = '!prestige';
const CONFIRM_WINDOW = 30; // Sekunden

// Pending-Map: username → timestamp
const pending = new Map();

async function handler({ client, channel, user }) {
    const player   = await getOrCreatePlayer(user);
    const leveling = getLeveling();

    // Max-Level berechnen
    const ranks    = leveling.Ranks || {};
    const maxLevel = Object.keys(ranks).reduce((max, k) => Math.max(max, parseInt(k) || 0), 50);

    if ((player.level || 1) < maxLevel) {
        client.say(channel,
            `⚠️ @${user}, du musst erst Level ${maxLevel} erreichen um Prestige zu werden! (Dein Level: ${player.level})`
        );
        return;
    }

    const now = Math.floor(Date.now() / 1000);

    // Abgelaufene Pending-Einträge aufräumen
    for (const [u, ts] of pending) {
        if (now - ts > CONFIRM_WINDOW) pending.delete(u);
    }

    const pendingSince = pending.get(user.toLowerCase());

    if (!pendingSince || (now - pendingSince) > CONFIRM_WINDOW) {
        // Erster Aufruf — Warnung ausgeben
        pending.set(user.toLowerCase(), now);
        const stashValue = getStashValue(player.id);
        client.say(channel,
            `⚠️ @${user}, ACHTUNG! Du verlierst deinen KOMPLETTEN Stash (${formatCurrency(stashValue)})! ` +
            `Tippe !prestige nochmal innerhalb von ${CONFIRM_WINDOW} Sekunden um zu bestätigen!`
        );
        return;
    }

    // Zweiter Aufruf — Wipe durchführen
    pending.delete(user.toLowerCase());

    const stashValue = getStashValue(player.id);
    const newPrestige = (player.prestige || 0) + 1;

    clearInventory(player.id);
    updatePlayer(user, {
        prestige: newPrestige,
        level:    1,
        xp:       0
    });

    client.say(channel,
        `🌟 WIPE! @${user} hat seinen Stash im Wert von ${formatCurrency(stashValue)} geopfert ` +
        `und ist nun PRESTIGE ${newPrestige}! Alles auf Null, Timmy! 🌟`
    );
}

module.exports = { command: COMMAND, handler };
