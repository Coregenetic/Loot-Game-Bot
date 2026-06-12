const tmi = require('tmi.js');

// Commands werden in Phase 2 implementiert
// Hier nur das Grundgerüst mit Command-Router

const commands = new Map();

function registerCommand(name, handler) {
    commands.set(name.toLowerCase(), handler);
}

function createBot() {
    const client = new tmi.Client({
        options: { debug: false },
        identity: {
            username: process.env.TWITCH_BOT_USERNAME,
            password: process.env.TWITCH_OAUTH_TOKEN
        },
        channels: [process.env.TWITCH_CHANNEL]
    });

    client.on('message', async (channel, userstate, message, self) => {
        if (self) return;                    // Eigene Nachrichten ignorieren
        if (!message.startsWith('!')) return; // Kein Command

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

    return { connect: () => client.connect(), client, registerCommand: registerCommand };
}

module.exports = { createBot, registerCommand };
