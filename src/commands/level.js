const { getOrCreatePlayer, getStashValue } = require('../db/players');
const { getLeveling } = require('../db/config');
const { calcXPForLevel, getRankName, formatCurrency } = require('../utils/format');
const fs   = require('fs');
const path = require('path');

const COMMAND = '!lvl';

// Pfad für OBS Overlay Datei
const LEVEL_DATA_PATH = process.env.LEVEL_DATA_PATH ||
    path.join(__dirname, '../../../data/level_data.json');

async function handler({ client, channel, user, args }) {
    const target = (args[0] || '').replace('@', '').toLowerCase() || user;
    const player = await getOrCreatePlayer(target);
    const leveling = getLeveling();

    const currentLevel = player.level || 1;
    const totalXP      = player.xp    || 0;
    const prestige     = player.prestige || 0;

    const xpForCurrent = calcXPForLevel(currentLevel, leveling);
    const xpForNext    = calcXPForLevel(currentLevel + 1, leveling);
    const xpInLevel    = Math.max(0, totalXP - xpForCurrent);
    const xpNeeded     = Math.max(1, xpForNext - xpForCurrent);
    const progress     = Math.min(100, Math.round((xpInLevel / xpNeeded) * 100));
    const rankName     = getRankName(currentLevel, leveling.Ranks);
    const stashValue   = getStashValue(player.id);

    const prestigeTag = prestige > 0 ? ` | ⭐ Prestige ${prestige}` : '';
    const kappaTag    = player.has_kappa ? ' | 🧳 Kappa' : '';

    client.say(channel,
        `/me 🪖 @${target} — Level ${currentLevel} | ${rankName}${prestigeTag}${kappaTag} | ` +
        `XP: ${xpInLevel}/${xpNeeded} (${progress}%) | Stash: ${formatCurrency(stashValue)} | ` +
        `Raids: ${player.raids_total || 0} | Überlebt: ${player.raids_survived || 0}`
    );

    // OBS Overlay Datei schreiben
    try {
        const levelData = {
            timestamp:    Date.now(),
            user:         target,
            level:        currentLevel,
            rank:         rankName,
            prestige,
            hasKappa:     player.has_kappa === 1,
            xp:           xpInLevel,
            xpNeeded,
            progress,
            stashValue,
            raidsTotal:   player.raids_total    || 0,
            raidsSurvived:player.raids_survived || 0,
            raidsDied:    player.raids_died     || 0
        };
        fs.mkdirSync(path.dirname(LEVEL_DATA_PATH), { recursive: true });
        fs.writeFileSync(LEVEL_DATA_PATH, JSON.stringify(levelData, null, 2));
    } catch {}
}

module.exports = { command: COMMAND, handler };
