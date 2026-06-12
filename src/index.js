require('dotenv').config();

const { initSchema, initDashboardUsers } = require('./db/schema');
const { getUserCount } = require('./db/users');
const { createBot }   = require('./bot');
const { startServer } = require('./api/server');

async function main() {
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║   Loot-Game Bot v2.0 by Coregenetic  ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');

    console.log('[BOOT] Initialisiere Datenbank...');
    await initSchema();
    await initDashboardUsers();
    console.log('[BOOT] Datenbank bereit.');

    // Warnung wenn noch keine User angelegt sind
    const userCount = getUserCount();
    if (userCount === 0) {
        console.log('[WARN] Keine Dashboard-User angelegt!');
        console.log('[WARN] Führe aus: npm run setup-users');
    }

    console.log('[BOOT] Starte API Server...');
    startServer();

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
