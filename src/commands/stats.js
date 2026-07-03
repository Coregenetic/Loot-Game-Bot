const COMMAND = '!stats';

async function handler({ client, channel, user }) {
    const url = process.env.PLAYER_HUB_URL || 'https://78-46-160-89.sslip.io/player-login.html';
    client.say(channel, `📊 @${user} Sieh deine Stats, Kappa-Fortschritt und dein Inventar im Player Hub: ${url}`);
}

module.exports = { command: COMMAND, handler };