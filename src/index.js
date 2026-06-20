require('dotenv').config();

const logger = require('./utils/logger');
const { initSchema, initDashboardUsers, initMessages } = require('./db/schema');
const { getUserCount } = require('./db/users');
const { createBot }    = require('./bot');
const { startServer }  = require('./api/server');

async function main() {
    logger.info('BOOT', '╔══════════════════════════════════════╗');
    logger.info('BOOT', '║   Loot-Game Bot v2.0 by Coregenetic  ║');
    logger.info('BOOT', '╚══════════════════════════════════════╝');

    logger.info('BOOT', 'Initialisiere Datenbank...');
    await initSchema();
    await initDashboardUsers();
    await initMessages();
    logger.info('BOOT', 'Datenbank bereit.');

    const userCount = getUserCount();
    if (userCount === 0) {
        logger.warn('BOOT', 'Keine Dashboard-User angelegt! Führe aus: npm run setup-users');
    }

    logger.info('BOOT', 'Starte API Server...');
    const { httpServer } = startServer();

    logger.info('BOOT', 'Verbinde Bot mit Twitch...');
    const bot = createBot();
    await bot.connect();
    global.botInstance = bot; // Für API-Zugriff

    const channels = process.env.TWITCH_CHANNEL || '';
    logger.bot('BOOT', `Bot verbunden — läuft in #${channels}`);
    logger.info('BOOT', 'Bereit für Commands.');

    // Automatisches Backup alle 6 Stunden
    const { createBackup } = require('./utils/backup');
    setInterval(() => {
        try {
            const backup = createBackup('auto');
            logger.info('BACKUP', `Automatisches Backup erstellt: ${backup.filename}`);
        } catch (err) {
            logger.error('BACKUP', `Backup fehlgeschlagen: ${err.message}`);
        }
    }, 6 * 60 * 60 * 1000);

    // Erstes Backup direkt beim Start
    try {
        const backup = createBackup('startup');
        logger.info('BACKUP', `Start-Backup erstellt: ${backup.filename}`);
    } catch (err) {
        logger.error('BACKUP', `Start-Backup fehlgeschlagen: ${err.message}`);
    }
}

main().catch(err => {
    console.error('[FATAL] Startfehler:', err.message);
    process.exit(1);
});
