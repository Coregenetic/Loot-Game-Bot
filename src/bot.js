const tmi = require('tmi.js');

const commands = new Map();

function registerCommand(name, handler) {
    commands.set(name.toLowerCase(), handler);
}

function loadCommands() {
    const commandFiles = [
        './commands/loot',
        './commands/stash',
        './commands/level',
        './commands/leaderboard',
        './commands/prestige',
        './commands/kappa'
    ];

    for (const file of commandFiles) {
        const cmd = require(file);
        registerCommand(cmd.command, cmd.handler);
        console.log(`[CMD] Geladen: ${cmd.command}`);
    }
}

function createBot() {
    const client = new tmi.Client({
        options: { debug: false },
        identity: {
            username: process.env.TWITCH_BOT_USERNAME,
            password: process.env.TWITCH_OAUTH_TOKEN
        },
        channels: process.env.TWITCH_CHANNEL.split(',').map(c => c.trim())
    });

    client.on('message', async (channel, userstate, message, self) => {
        if (self) return;
        if (!message.startsWith('!')) return;

        const parts   = message.trim().split(/\s+/);
        const cmdName = parts[0].toLowerCase();
        const args    = parts.slice(1);
        const user    = userstate.username;

        const handler = commands.get(cmdName);
        if (!handler) return;

        try {
            await handler({ client, channel, user, userstate, args });
        } catch (err) {
            console.error(`[CMD] Fehler bei ${cmdName} von ${user}:`, err.message);
        }
    });

    client.on('connected', (addr, port) => {
        console.log(`[BOT] Verbunden mit ${addr}:${port}`);
    });

    client.on('disconnected', reason => {
        console.warn(`[BOT] Verbindung getrennt: ${reason}`);
    });

    // Commands laden
    loadCommands();

    return { connect: () => client.connect(), client };
}

module.exports = { createBot };
