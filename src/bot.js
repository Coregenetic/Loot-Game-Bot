const tmi    = require('tmi.js');
const logger = require('./utils/logger');

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
        logger.cmd('BOT', `Geladen: ${cmd.command}`);
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

        logger.cmd('CMD', `${user} → ${cmdName} in ${channel}`);

        try {
            await handler({ client, channel, user, userstate, args });
        } catch (err) {
            logger.error('CMD', `Fehler bei ${cmdName} von ${user}: ${err.message}`);
        }
    });

    client.on('connected', (addr, port) => {
        logger.bot('BOT', `Verbunden mit ${addr}:${port}`);
    });

    client.on('disconnected', reason => {
        logger.warn('BOT', `Verbindung getrennt: ${reason}`);
    });

    loadCommands();

    return { connect: () => client.connect(), client };
}

module.exports = { createBot };