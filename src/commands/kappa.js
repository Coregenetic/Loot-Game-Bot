const { getOrCreatePlayer, updatePlayer, getInventory,
        addOrUpdateInventoryItem, removeInventoryItem } = require('../db/players');
const { getKappaItems } = require('../db/items');
const { generateKappaToken } = require('../utils/kappaTokens');

const COMMAND = '!kappa';
const KAPPA_CONTAINER_NAME = 'Kappa Container';
const BASE_URL = process.env.GAME_CENTER_URL || 'https://lootgamebot.fly.dev';

async function handler({ client, channel, user }) {
    const player = await getOrCreatePlayer(user);

    if (player.has_kappa === 1) {
        client.say(channel, `🧳 @${user} hat bereits den Kappa Container! ABSOLUTE LEGENDE! 🏆`);
        return;
    }

    const kappaItems = getKappaItems();

    if (!kappaItems.length) {
        client.say(channel, `⚠️ @${user}, keine Kappa-Items in der Datenbank definiert.`);
        return;
    }

    const inventory = getInventory(player.id);
    const invMap    = new Map(inventory.map(i => [i.item_name.toLowerCase(), i]));

    let found = 0;
    const total = kappaItems.length;

    for (const kItem of kappaItems) {
        const textName = (kItem.text || kItem.name).toLowerCase();
        const invItem  = invMap.get(textName);
        if (invItem && invItem.count > 0) found++;
    }

    if (found < total) {
        const token = generateKappaToken(user);
        client.say(channel,
            `🧳 @${user}: ${found} / ${total} Kappa-Items gesammelt. ` +
            `Noch ${total - found} Items übrig — weiter looten, Timmy! ` +
            `📋 Deine Übersicht: ${BASE_URL}/kappa.html?token=${token}`
        );
        return;
    }

    // Alle vorhanden — Tausch durchführen
    for (const kItem of kappaItems) {
        const textName = kItem.text || kItem.name;
        removeInventoryItem(player.id, textName, 1);
    }

    addOrUpdateInventoryItem(player.id, KAPPA_CONTAINER_NAME, 1, 0);
    updatePlayer(user, { has_kappa: 1 });

    client.say(channel,
        `🏆 @${user} hat ALLE ${total} Kappa-Items abgegeben und erhält den ` +
        `KAPPA CONTAINER! 🧳 ABSOLUTE LEGENDE VON TARKOV! 🌟`
    );
}

module.exports = { command: COMMAND, handler };
