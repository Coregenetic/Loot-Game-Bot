require('dotenv').config();

const { initSchema } = require('./db/schema');
const { createBot }  = require('./bot');

async function main() {
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║   Loot-Game Bot v2.0 by Coregenetic  ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');

    // 1. Datenbank initialisieren
    console.log('[BOOT] Initialisiere Datenbank...');
    initSchema();
    console.log('[BOOT] Datenbank bereit.');

    // 2. Bot starten
    console.log('[BOOT] Verbinde Bot mit Twitch...');
    const bot = createBot();
    await bot.connect();

    console.log(`[BOOT] Bot verbunden — läuft in #${process.env.TWITCH_CHANNEL}`);
    console.log('[BOOT] Bereit für Commands.');
}

main().catch(err => {
    console.error('[FATAL] Startfehler:', err);
    process.exit(1);
});
