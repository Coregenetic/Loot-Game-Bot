const { getItemsForMap } = require('../db/items');
const { getGeneral, getMaps, getActiveEvents, getLeveling } = require('../db/config');
const { getRandomMessage } = require('../db/messages');
const { formatCurrency, calcLevelFromXP, calcXPForLevel, getRankName } = require('../utils/format');

// ─── Map Emojis ───────────────────────────────────────────────────────────────
const MAP_EMOJIS = {
    'Customs':       '🏭',
    'Factory':       '🔧',
    'Ground Zero':   '💥',
    'Interchange':   '🏬',
    'Icebreaker':    '🧊',
    'Lighthouse':    '🔦',
    'Reserve':       '🪖',
    'Shoreline':     '🌊',
    'Streets':       '🌆',
    'Lab':           '🔬',
    'Woods':         '🌲',
    'The Labyrinth': '🌀'
};

function getMapEmoji(map) {
    return MAP_EMOJIS[map] || '🗺️';
}

// ─── Map auswählen ────────────────────────────────────────────────────────────
function selectMap(config) {
    const maps    = getMaps();
    const events  = getActiveEvents();
    const now     = Math.floor(Date.now() / 1000);

    // Forced Map Event aktiv?
    if (events.ForcedMap && events.ForcedMap.MapName &&
        events.ForcedMap.ExpiresAt > now) {
        return events.ForcedMap.MapName;
    }

    // Gewichtete Zufallsauswahl
    const entries = Object.entries(maps);
    if (!entries.length) return 'Customs';

    const total  = entries.reduce((sum, [, w]) => sum + w, 0);
    let   random = Math.random() * total;

    for (const [map, weight] of entries) {
        random -= weight;
        if (random <= 0) return map;
    }
    return entries[0][0];
}

// ─── Item auswählen ───────────────────────────────────────────────────────────
function selectItem(mapName) {
    const items = getItemsForMap(mapName);
    if (!items.length) return null;
    return items[Math.floor(Math.random() * items.length)];
}

// ─── Loot generieren ─────────────────────────────────────────────────────────
function generateLoot(hasKappa = false, forcedMap = null, generalOverride = null) {
    const general = generalOverride || getGeneral();
    const events  = getActiveEvents();
    const now     = Math.floor(Date.now() / 1000);

    const map  = forcedMap || selectMap();
    const item = selectItem(map);
    if (!item) return null;

    let doubleLootChance = general.DoubleLootChance ?? 0.03;

    // Event Override
    if (events.DoubleLootOverride && events.DoubleLootOverride.Chance > 0 &&
        events.DoubleLootOverride.ExpiresAt > now) {
        doubleLootChance = events.DoubleLootOverride.Chance;
    }

    // Kappa Bonus
    if (hasKappa) {
        doubleLootChance += (general.KappaDoubleLootBonus ?? 0.10);
    }

    const loot = [{ item, map }];

    if (Math.random() <= doubleLootChance) {
        const item2 = selectItem(map);
        if (item2) loot.push({ item: item2, map });
    }

    return loot;
}

// ─── XP berechnen ────────────────────────────────────────────────────────────
function calculateXPGain(itemValue, prestige = 0) {
    const leveling  = getLeveling();
    const general   = getGeneral();
    const malus     = leveling.PrestigeXPMalus || 0.1;
    const divisor   = general.XPDivisor || 1000;
    // Sicherstellen dass value eine Zahl ist
    const val       = typeof itemValue === 'number' ? itemValue : parseInt(String(itemValue).replace(/[^0-9]/g, '')) || 0;
    const baseXP    = Math.max(10, Math.floor(val / divisor));
    const modifier  = Math.max(0.1, 1 - (prestige * malus));
    return Math.floor(baseXP * modifier);
}

// ─── Nachrichten formatieren ──────────────────────────────────────────────────
function formatInfiltrationMsg(user, map) {
    return `${getMapEmoji(map)} @${user} startet einen Raid auf ${map}...`;
}

function formatLootMsg(user, loot, hasKappa = false) {
    const kappaTag = hasKappa ? ' 🧳' : '';
    const map      = loot[0].map;
    const emoji    = getMapEmoji(map);

    if (loot.length > 1) {
        const v1 = formatCurrency(loot[0].item.value);
        const v2 = formatCurrency(loot[1].item.value);
        return `${emoji} 🔥 DOPPEL-LOOT! @${user}${kappaTag} entkommt von ${map} mit ${loot[0].item.text} [${v1}] & ${loot[1].item.text} [${v2}]!`;
    }

    const item      = loot[0].item;
    const itemName  = item.text || item.name;
    const itemValue = formatCurrency(item.value);

    // Map-Nachricht aus DB laden (map_massages)
    const template = getRandomMessage('map', map);
    if (template) {
        const msg = template
            .replace(/{user}/g,    `@${user}${kappaTag}`)
            .replace(/@{user}/g,   `@${user}${kappaTag}`)
            .replace(/{itemName}/g, `${itemName}`)
            .replace(/{mapName}/g,  map);
        return `${emoji} @${user}${kappaTag} ${msg} [${itemValue}]`;
    }

    // Fallback
    return `${emoji} @${user}${kappaTag} entkommt mit ${itemName} [${itemValue}]!`;
}

function formatDeathMsg(user, map) {
    const emoji = getMapEmoji(map);

    // Tod-Nachricht aus DB laden
    const msg = getRandomMessage('death', map);
    if (msg) {
        return `${emoji} 💀 @${user} ${msg}`;
    }

    // Fallback
    const fallbacks = [
        `ist auf ${map} verreckt. Pech gehabt, Timmy.`,
        `wurde auf ${map} ausgelöscht. GG.`,
        `hat ${map} nicht überlebt. Typisch.`
    ];
    return `${emoji} 💀 @${user} ${fallbacks[Math.floor(Math.random() * fallbacks.length)]}`;
}

// ─── Pro-Spieler-Ergebnis berechnen (genutzt von Solo- UND Squad-Raids) ──────
// Bei Squad-Raids ist 'survived' schon von außen vorgegeben (ein gemeinsamer
// Wurf für die ganze Gruppe) — hier wird nur noch der individuelle Loot/XP
// pro Mitglied gewürfelt, falls überlebt.
function computePlayerOutcome(player, survived, forcedMap = null, generalOverride = null, valueMultiplier = 1) {
    const oldLevel = player.level || 1;
    if (!survived) {
        return { lootPayload: [], xpGain: 0, oldLevel, newLevel: oldLevel, map: forcedMap };
    }

    const loot = generateLoot(player.has_kappa === 1, forcedMap, generalOverride);
    if (!loot) {
        return { lootPayload: [], xpGain: 0, oldLevel, newLevel: oldLevel, map: forcedMap };
    }

    const map = forcedMap || loot[0].map;
    const lootPayload = loot.map(({ item }) => ({
        displayName: item.text || item.name,
        value: Math.round((item.value || 0) * valueMultiplier),
        key: item.name
    }));

    const events    = getActiveEvents();
    const now       = Math.floor(Date.now() / 1000);
    const leveling  = getLeveling();
    let xpMultiplier = 1;
    if (events.XPBoost?.Multiplier > 1 && events.XPBoost?.ExpiresAt > now) {
        xpMultiplier = events.XPBoost.Multiplier;
    }

    // XP basiert auf dem (ggf. durch valueMultiplier erhöhten) tatsächlichen Loot-Wert
    const totalItemValue = lootPayload.reduce((sum, i) => sum + i.value, 0);
    const xpGain   = Math.floor(calculateXPGain(totalItemValue, player.prestige) * xpMultiplier);
    const newLevel = calcLevelFromXP((player.xp || 0) + xpGain, leveling);

    return { lootPayload, xpGain, oldLevel, newLevel, map };
}

module.exports = {
    generateLoot, selectMap, calculateXPGain, computePlayerOutcome,
    formatInfiltrationMsg, formatLootMsg, formatDeathMsg,
    getMapEmoji
};