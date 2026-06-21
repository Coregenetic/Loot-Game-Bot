/**
 * Read-only Diagnose-Script — durchsucht ALLE Backups nach dem Zeitpunkt,
 * an dem 'death' und 'map' Nachrichten noch unterschiedlich waren.
 * Verändert NICHTS — öffnet jede Backup-Datei nur als separate, isolierte
 * sql.js-Instanz im Speicher, rührt die laufende Live-DB nicht an.
 *
 * Aufruf (z.B. via `fly ssh console`):
 *   node scripts/inspect-message-backups.js
 */
const fs   = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const BACKUP_DIR = process.env.NODE_ENV === 'production'
    ? '/app/data/backups'
    : path.join(__dirname, '../data/backups');

function fingerprint(rows) {
    return JSON.stringify(rows.map(r => [r.map, r.text]).sort());
}

async function main() {
    const SQL = await initSqlJs();

    if (!fs.existsSync(BACKUP_DIR)) {
        console.log('Kein Backup-Ordner gefunden:', BACKUP_DIR);
        return;
    }

    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.db'))
        .map(f => ({ filename: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
        .sort((a, b) => a.mtime - b.mtime); // älteste zuerst

    if (!files.length) {
        console.log('Keine Backups im Ordner gefunden.');
        return;
    }

    console.log(`Durchsuche ${files.length} Backups (älteste zuerst)...\n`);

    for (const { filename, mtime } of files) {
        const filepath = path.join(BACKUP_DIR, filename);
        let db;
        try {
            const buffer = fs.readFileSync(filepath);
            db = new SQL.Database(buffer);
        } catch (err) {
            console.log(`[${filename}] -- konnte nicht geöffnet werden (${err.message})`);
            continue;
        }

        let deathRows = [];
        let mapRows = [];
        try {
            const stmt1 = db.prepare(`SELECT map, text FROM messages WHERE type = 'death' ORDER BY map, id`);
            while (stmt1.step()) deathRows.push(stmt1.getAsObject());
            stmt1.free();

            const stmt2 = db.prepare(`SELECT map, text FROM messages WHERE type = 'map' ORDER BY map, id`);
            while (stmt2.step()) mapRows.push(stmt2.getAsObject());
            stmt2.free();
        } catch (err) {
            console.log(`[${filename}] -- messages-Tabelle nicht lesbar (${err.message})`);
            db.close();
            continue;
        }
        db.close();

        const identical = fingerprint(deathRows) === fingerprint(mapRows);
        const dateStr = new Date(mtime).toLocaleString('de-DE');

        console.log(`[${filename}]  (${dateStr})`);
        console.log(`   death: ${deathRows.length} Einträge   map: ${mapRows.length} Einträge   ${identical ? '⚠️  IDENTISCH (vermutlich überschrieben)' : '✅ UNTERSCHIEDLICH'}`);
        if (!identical && deathRows.length > 0) {
            console.log('   --- death-Inhalte in diesem Backup ---');
            deathRows.forEach(r => console.log(`   [${r.map}] ${r.text}`));
        }
        console.log('');
    }

    console.log('Fertig. Suche nach dem NEUESTEN Backup mit "✅ UNTERSCHIEDLICH" oben — das ist der beste Wiederherstellungs-Kandidat.');
}

main().catch(err => { console.error('Fehler:', err); process.exit(1); });