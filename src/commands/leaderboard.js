const { getLeaderboard } = require('../db/players');
const { formatShort }    = require('../utils/format');

const COMMAND = '!toplooter';
const COOLDOWN = 15;

// Letzter !toplooter Aufruf — für /overlay/leaderboard
let latestLeaderboardData = null;
function getLatestLeaderboardData() { return latestLeaderboardData; }

async function handler({ client, channel, user }) {
    // Globaler Cooldown
    const cooldownKey = `leaderboard_global_${channel}`;
    const lastRun     = global[cooldownKey] || 0;
    const now         = Math.floor(Date.now() / 1000);

    if (now - lastRun < COOLDOWN) {
        client.say(channel, `⏳ @${user}, das Leaderboard kann nur alle ${COOLDOWN} Sekunden abgerufen werden.`);
        return;
    }
    global[cooldownKey] = now;

    const players = getLeaderboard(5);

    if (!players.length) {
        client.say(channel, '📊 Noch keine Looter auf dem Leaderboard.');
        return;
    }

    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    const parts  = players.map((p, i) => {
        const kappa    = p.has_kappa ? ' 🧳' : '';
        const prestige = p.prestige > 0 ? ` ⭐P${p.prestige}` : '';
        return `${medals[i]} @${p.username}${prestige}${kappa} — ${formatShort(p.stash_value)} ₽`;
    });

    client.say(channel, `/me 🏆 TOP LOOTERS: ${parts.join(' | ')}`);

    // Overlay-Daten im RAM speichern — triggert das OBS Overlay
    latestLeaderboardData = {
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
}

module.exports = { command: COMMAND, handler, getLatestLeaderboardData };
