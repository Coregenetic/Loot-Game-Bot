const COMMAND = '!gameconfig';

async function handler({ client, channel, user }) {
    const url = process.env.GAME_CENTER_URL || 'https://lootgamebot.fly.dev';
    client.say(channel, `🎮 @${user} Das Loot-Game Center findest du hier: ${url} — Dort kannst du deinen Stash, dein Level und die Bestenliste einsehen!`);
}

module.exports = { command: COMMAND, handler };
