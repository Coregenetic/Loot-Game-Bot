const { getLeaderboard, isOnCooldown, setCooldown } = require('../db/players');
const { formatShort } = require('../utils/format');
const fs   = require('fs');
const path = require('path');

const COMMAND = '!toplooter';
const COOLDOWN = 15;

const LEADERBOARD_DATA_PATH = process.env.LEADERBOARD_DATA_PATH ||
    path.join(__dirname, '../../../data/leaderboard_data.json');

async function handler({ client, channel, user }) {
    // Globaler Cooldown — nicht pro Spieler
    const cooldownKey = `leaderboard_global_${channel}`;
    const lastRun = global[cooldownKey] || 0;
    const now     = Math.floor(Date.now() / 1000);

    if (now - lastRun < COOLDOWN) {
        client.say(channel,
            `⏳ @${user}, das Leaderboard kann nur alle ${COOLDOWN} Sekunden abgerufen werden.`
        );
        return;
    }
    global[cooldownKey] = now;

    const players = getLeaderboard(5);

    if (!players.length) {
        client.say(channel, '📊 Noch keine Looter auf dem Leaderboard.');
        return;
    }

    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];

    const parts = players.map((p, i) => {
        const kappa    = p.has_kappa ? ' 🧳' : '';
        const prestige = p.prestige  > 0 ? ` ⭐P${p.prestige}` : '';
        return `${medals[i]} @${p.username}${prestige}${kappa} — ${formatShort(p.stash_value)} ₽`;
    });

    client.say(channel, `/me 🏆 TOP LOOTERS: ${parts.join(' | ')}`);

    // OBS Overlay Datei schreiben
    try {
        const exportData = {
            timestamp:   Date.now(),
            triggerUser: user.toLowerCase(),
            players: players.map(p => ({
                name:           p.username,
                value:          p.stash_value,
                formattedValue: formatShort(p.stash_value),
                level:          p.level,
                prestige:       p.prestige,
                hasKappa:       p.has_kappa === 1
            }))
        };
        fs.mkdirSync(path.dirname(LEADERBOARD_DATA_PATH), { recursive: true });
        fs.writeFileSync(LEADERBOARD_DATA_PATH, JSON.stringify(exportData, null, 2));
    } catch {}
}

module.exports = { command: COMMAND, handler };
