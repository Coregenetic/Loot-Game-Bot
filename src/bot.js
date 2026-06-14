const tmi    = require('tmi.js');
const logger = require('./utils/logger');

const commands       = new Map();
const activeChannels = new Set(); // Channels die auf Commands reagieren

function registerCommand(name, handler) {
    commands.set(name.toLowerCase(), handler);
}

function setChannelActive(channel, active) {
    const ch = channel.replace('#', '').toLowerCase();
    if (active) {
        activeChannels.add(ch);
        logger.bot('BOT', `Channel aktiviert: #${ch}`);
    } else {
        activeChannels.delete(ch);
        logger.bot('BOT', `Channel deaktiviert: #${ch}`);
    }
}

function getChannelStatus() {
    return Object.fromEntries(
        process.env.TWITCH_CHANNEL.split(',').map(c => {
            const ch = c.trim().toLowerCase();
            return [ch, activeChannels.has(ch)];
        })
    );
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
    const channels = process.env.TWITCH_CHANNEL.split(',').map(c => c.trim().toLowerCase());

    // Alle Channels standardmäßig aktiv
    channels.forEach(ch => activeChannels.add(ch));

    const client = new tmi.Client({
        options: { debug: false },
        identity: {
            username: process.env.TWITCH_BOT_USERNAME,
            password: process.env.TWITCH_OAUTH_TOKEN
        },
        channels
    });

    client.on('message', async (channel, userstate, message, self) => {
        if (self) return;
        if (!message.startsWith('!')) return;

        const ch = channel.replace('#', '').toLowerCase();

        // Channel aktiv?
        if (!activeChannels.has(ch)) return;

        const parts   = message.trim().split(/\s+/);
        const cmdName = parts[0].toLowerCase();
        const user    = userstate.username;

        const handler = commands.get(cmdName);
        if (!handler) return;

        logger.cmd('CMD', `${user} → ${cmdName} in ${channel}`);

        try {
            await handler({ client, channel, user, userstate, args: parts.slice(1) });
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

    return { connect: () => client.connect(), client, setChannelActive, getChannelStatus };
}

module.exports = { createBot };
