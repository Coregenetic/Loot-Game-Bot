const tmi    = require('tmi.js');
const logger = require('./utils/logger');

const commands       = new Map();
const activeChannels = new Set();
const disabledCmds   = new Set();
let   maintenanceMode = false;
let   tournamentMode  = false;

function setMaintenance(active, client) {
    maintenanceMode = active;
    logger.bot('BOT', `Wartungsmodus ${active ? 'aktiviert' : 'deaktiviert'}`);
    if (client) {
        const msg = active
            ? '🔧 Das Loot-Game ist jetzt im Wartungsmodus. Wir sind gleich zurück!'
            : '✅ Das Loot-Game ist wieder verfügbar! Viel Erfolg beim Looten!';
        for (const ch of activeChannels) {
            client.say(`#${ch}`, msg).catch(() => {});
        }
    }
}

function setTournament(active, client) {
    tournamentMode = active;
    logger.bot('BOT', `Turnier-Modus ${active ? 'aktiviert' : 'deaktiviert'}`);
    if (client) {
        const msg = active
            ? '🏆 Das Loot-Game ist während des Raids pausiert. Nach dem Raid geht es weiter!'
            : '✅ Das Loot-Game ist wieder aktiv — viel Spaß beim Looten!';
        for (const ch of activeChannels) {
            client.say(`#${ch}`, msg).catch(() => {});
        }
    }
}

function getMaintenanceMode() { return maintenanceMode; }
function getTournamentMode()  { return tournamentMode; }

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

function setCommandActive(cmd, active) {
    const c = cmd.toLowerCase();
    if (active) {
        disabledCmds.delete(c);
        logger.bot('BOT', `Command aktiviert: ${c}`);
    } else {
        disabledCmds.add(c);
        logger.bot('BOT', `Command deaktiviert: ${c}`);
    }
}

function getCommandStatus() {
    return Object.fromEntries(
        [...commands.keys()].map(cmd => [cmd, !disabledCmds.has(cmd)])
    );
}

function loadCommands() {
    const commandFiles = [
        './commands/loot',
        './commands/stash',
        './commands/level',
        './commands/leaderboard',
        './commands/prestige',
        './commands/kappa',
        './commands/gameconfig'
    ];
    for (const file of commandFiles) {
        const cmd = require(file);
        registerCommand(cmd.command, cmd.handler);
        logger.cmd('BOT', `Geladen: ${cmd.command}`);
    }
}

function createBot() {
    const channels = process.env.TWITCH_CHANNEL.split(',').map(c => c.trim().toLowerCase());
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
        if (!activeChannels.has(ch)) return;

        // Wartungsmodus — antwortet mit Meldung
        if (maintenanceMode) {
            if (message.startsWith('!')) {
                client.say(channel, `🔧 @${userstate.username}, das Loot-Game ist gerade im Wartungsmodus. Wir sind gleich zurück!`);
            }
            return;
        }

        // Turnier-Modus — komplett still
        if (tournamentMode) return;

        const parts   = message.trim().split(/\s+/);
        const cmdName = parts[0].toLowerCase();

        if (disabledCmds.has(cmdName)) return;

        const handler = commands.get(cmdName);
        if (!handler) return;

        logger.cmd('CMD', `${userstate.username} → ${cmdName} in ${channel}`);

        try {
            await handler({ client, channel, user: userstate.username, userstate, args: parts.slice(1) });
        } catch (err) {
            logger.error('CMD', `Fehler bei ${cmdName} von ${userstate.username}: ${err.message}`);
        }
    });

    client.on('connected', (addr, port) => {
        logger.bot('BOT', `Verbunden mit ${addr}:${port}`);
    });

    client.on('disconnected', reason => {
        logger.warn('BOT', `Verbindung getrennt: ${reason}`);
    });

    loadCommands();

    return { connect: () => client.connect(), client, setChannelActive, getChannelStatus, setCommandActive, getCommandStatus, setMaintenance: (active) => setMaintenance(active, client), getMaintenanceMode, setTournament: (active) => setTournament(active, client), getTournamentMode };
}

module.exports = { createBot };