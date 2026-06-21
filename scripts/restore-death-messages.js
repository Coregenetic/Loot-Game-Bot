/**
 * Gezielte Wiederherstellung — extrahiert NUR die 'death'-Nachrichten aus
 * einer gewählten Backup-Datei und schreibt sie in die LAUFENDE Datenbank.
 * Rührt sonst NICHTS an (keine Spieler, Items, Cooldowns, map-Nachrichten etc.)
 * — anders als ein kompletter Backup-Restore, der alles zurückrollen würde.
 *
 * Aufruf (z.B. via `fly ssh console`):
 *   node scripts/restore-death-messages.js backup_2026-06-10T10-00-00_auto.db
 */
const fs   = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const BACKUP_DIR = process.env.NODE_ENV === 'production'
    ? '/app/data/backups'
    : path.join(__dirname, '../data/backups');

async function main() {
    const filename = process.argv[2];
    if (!filename) {
        console.error('Bitte Backup-Dateiname angeben, z.B.:');
        console.error('  node scripts/restore-death-messages.js backup_2026-06-10T10-00-00_auto.db');
        process.exit(1);
    }

    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) {
        console.error('Backup-Datei nicht gefunden:', filepath);
        process.exit(1);
    }

    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(filepath);
    const backupDb = new SQL.Database(buffer);

    const deathByMap = {};
    const stmt = backupDb.prepare(`SELECT map, text FROM messages WHERE type = 'death' ORDER BY map, id`);
    while (stmt.step()) {
        const row = stmt.getAsObject();
        if (!deathByMap[row.map]) deathByMap[row.map] = [];
        deathByMap[row.map].push(row.text);
    }
    stmt.free();
    backupDb.close();

    const total = Object.values(deathByMap).reduce((sum, arr) => sum + arr.length, 0);
    if (total === 0) {
        console.log('Keine death-Nachrichten in diesem Backup gefunden — nichts zu tun.');
        process.exit(0);
    }

    console.log(`Gefunden: ${total} death-Nachrichten in "${filename}":`);
    for (const [map, texts] of Object.entries(deathByMap)) {
        texts.forEach(t => console.log(`  [${map}] ${t}`));
    }

    console.log('\nSchreibe in die LAUFENDE Datenbank (nur Typ "death", alles andere bleibt unberührt)...');

    try { require('dotenv').config(); } catch {}
    const { initSchema } = require('../src/db/schema');
    const { setMessages } = require('../src/db/messages');

    await initSchema();
    setMessages('death', deathByMap);

    console.log('✓ Fertig. death-Nachrichten wiederherstellt.');
    console.log('Hinweis: Falls der Bot-Prozess bereits läuft, einmal neu starten (fly deploy oder Machine-Restart), damit der RAM-Stand neu von der Platte geladen wird.');
}

main().catch(err => { console.error('Fehler:', err); process.exit(1); });