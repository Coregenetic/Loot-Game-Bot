const { getOrCreatePlayer, getInventory, getStashValue } = require('../db/players');
const { formatCurrency, formatShort } = require('../utils/format');

const COMMAND = '!stash';

async function handler({ client, channel, user, args }) {
    // Optionaler Target-User: !stash @someone
    const target = (args[0] || '').replace('@', '').toLowerCase() || user;
    const player = await getOrCreatePlayer(target);

    const inventory = getInventory(player.id);

    if (!inventory.length) {
        client.say(channel, `🎒 @${target}, dein Inventar ist leer. Benutze !loot um Items zu sammeln!`);
        return;
    }

    const totalValue = getStashValue(player.id);
    const top3       = inventory.slice(0, 3);
    const prestigeTag = player.prestige > 0 ? ` [Prestige ${player.prestige} 🌟]` : '';

    let msg = `/me 🎒 TOP ITEMS VON @${target.toUpperCase()}${prestigeTag} — `;
    msg += top3.map(i => `${i.count}x ${i.item_name} (${formatCurrency(i.value)})`).join(' | ');
    msg += ` — 💰 Gesamt: ${formatCurrency(totalValue)} | 📦 ${inventory.length} verschiedene Items`;

    client.say(channel, msg);
}

module.exports = { command: COMMAND, handler };
