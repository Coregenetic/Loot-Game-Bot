require('dotenv').config();

const fs     = require('fs');
const logger = require('./utils/logger');
const { initSchema, initDashboardUsers, initMessages, all } = require('./db/schema');
const { getUserCount } = require('./db/users');
const { createBot }    = require('./bot');
const { startServer }  = require('./api/server');
const { DB_PATH, listBackups, restoreBackup, createBackup } = require('./utils/backup');

async function main() {
    logger.info('BOOT', '╔══════════════════════════════════════╗');
    logger.info('BOOT', '║   Loot-Game Bot v2.0 by Coregenetic  ║');
    logger.info('BOOT', '╚══════════════════════════════════════╝');

    // Prüfen ob DB-Datei fehlt — vor initSchema, da das sonst eine leere DB anlegt
    const dbMissing = !fs.existsSync(DB_PATH);
    if (dbMissing) {
        logger.warn('BOOT', 'Keine Datenbank-Datei gefunden — prüfe auf Backups...');
        const backups = listBackups();
        if (backups.length > 0) {
            try {
                restoreBackup(backups[0].filename);
                logger.info('BOOT', `Neuestes Backup automatisch wiederherstellt: ${backups[0].filename}`);
            } catch (err) {
                logger.error('BOOT', `Auto-Restore fehlgeschlagen: ${err.message}`);
            }
        } else {
            logger.warn('BOOT', 'Keine Backups vorhanden — starte mit leerer Datenbank.');
        }
    }

    logger.info('BOOT', 'Initialisiere Datenbank...');
    await initSchema();
    await initDashboardUsers();
    await initMessages();
    logger.info('BOOT', 'Datenbank bereit.');

    // Zusätzlicher Check: DB existierte, aber Items-Tabelle ist komplett leer
    // (z.B. bei beschädigter/zurückgesetzter DB) — dann ebenfalls Backup laden
    if (!dbMissing) {
        try {
            const items = all(`SELECT COUNT(*) as count FROM items`);
            if (items[0]?.count === 0) {
                logger.warn('BOOT', 'Items-Tabelle ist leer — prüfe auf Backups...');
                const backups = listBackups();
                if (backups.length > 0) {
                    restoreBackup(backups[0].filename);
                    logger.info('BOOT', `Backup wiederherstellt: ${backups[0].filename} — bitte Server manuell neu starten.`);
                }
            }
        } catch (err) {
            logger.error('BOOT', `Leer-Check fehlgeschlagen: ${err.message}`);
        }
    }

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

    // ─── EventSub-Shadow (Phase 1 der Bot-Badge-Migration) ────────────────────
    // Läuft komplett parallel zum tmi.js-Bot oben, sendet NICHTS automatisch,
    // beobachtet nur. Standardmäßig AUS — kein Risiko für den Live-Betrieb.
    if (process.env.ENABLE_EVENTSUB_SHADOW === 'true') {
        logger.info('BOOT', 'EventSub-Shadow aktiviert — starte parallele Beobachtungs-Verbindung...');
        const eventSubShadow = require('./bot-eventsub');
        eventSubShadow.start(); // kein Callback in Phase 1 = nur loggen, keine Commands verarbeiten
        global.eventSubShadow = eventSubShadow; // für manuelles Testen über die API
    }

    // Automatisches Backup alle 6 Stunden
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