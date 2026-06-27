const tmi    = require('tmi.js');
const logger = require('./utils/logger');

// Bestimmt, welche Verbindung tatsächlich Commands verarbeitet & antwortet.
// 'tmi' (Default) = klassische IRC-Verbindung wie bisher. 'eventsub' = neue
// Helix/EventSub-Verbindung (Phase 2 der Bot-Badge-Migration). Die jeweils
// andere Verbindung bleibt verbunden, ist aber für Commands stumm.
const COMMAND_SOURCE = (process.env.COMMAND_SOURCE || 'tmi').toLowerCase();

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

// ─── Gemeinsame Command-Verarbeitung ───────────────────────────────────────────
// Wird von BEIDEN Verbindungstypen genutzt (tmi.js und EventSub) — die Logik
// existiert nur einmal, damit es nie zu Abweichungen zwischen den beiden
// Pfaden kommen kann. `client` muss nur eine .say(channel, message)-Methode
// haben — tmi.js' echter Client erfüllt das nativ, der EventSub-Pfad nutzt
// einen kleinen Adapter (siehe bot-eventsub.js).
async function processCommand({ client, channel, username, message, userstate }) {
    const ch = channel.replace('#', '').toLowerCase();
    if (!activeChannels.has(ch)) return;
    if (!message.startsWith('!')) return;

    // Wartungsmodus — antwortet mit Meldung
    if (maintenanceMode) {
        client.say(channel, `🔧 @${username}, das Loot-Game ist gerade im Wartungsmodus. Wir sind gleich zurück!`);
        return;
    }

    // Turnier-Modus — komplett still
    if (tournamentMode) return;

    const parts   = message.trim().split(/\s+/);
    const cmdName = parts[0].toLowerCase();

    if (disabledCmds.has(cmdName)) return;

    const handler = commands.get(cmdName);
    if (!handler) return;

    logger.cmd('CMD', `${username} → ${cmdName} in ${channel}`);

    // Analytics — alle Commands außer !loot (der loggt sich selbst mit mehr Details)
    if (cmdName !== '!loot') {
        const { logCommand } = require('./utils/analytics');
        logCommand(cmdName, username, channel);
    }

    try {
        await handler({ client, channel, user: username, userstate: userstate || { username }, args: parts.slice(1) });
    } catch (err) {
        logger.error('CMD', `Fehler bei ${cmdName} von ${username}: ${err.message}`);
    }
}

function touchOnlineStatus(username, channel) {
    const ch = channel.replace('#', '').toLowerCase();
    if (!activeChannels.has(ch)) return;
    try { require('./db/players').touchLastSeen(username); } catch (_) {}
}

function loadCommands() {
    const commandFiles = [
        './commands/loot',
        './commands/stash',
        './commands/level',
        './commands/leaderboard',
        './commands/prestige',
        './commands/kappa',
        './commands/stats'
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

        // Wenn EventSub die aktive Quelle ist, bleibt tmi.js verbunden aber
        // komplett passiv — keine doppelte Verarbeitung, keine doppelten Antworten.
        if (COMMAND_SOURCE !== 'tmi') return;

        const ch = channel.replace('#', '').toLowerCase();

        // Online-Status: bei JEDER Nachricht in einem aktiven Channel aktualisieren,
        // nicht nur bei Commands. Legt keine neuen Spieler an — nur ein Update für
        // bereits bekannte Spieler (Zuschauer ohne Profil bleiben unberührt).
        touchOnlineStatus(userstate.username, channel);

        await processCommand({ client, channel, username: userstate.username, message, userstate });
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

module.exports = { createBot, processCommand, touchOnlineStatus, COMMAND_SOURCE };