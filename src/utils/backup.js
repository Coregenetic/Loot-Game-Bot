/**
 * Backup-System für die better-sqlite3 Datenbank.
 * Backups werden als Datei-Kopien im /app/data/backups Ordner gespeichert.
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH = process.env.NODE_ENV === 'production'
    ? '/app/data/lootgame.db'
    : path.join(__dirname, '../../data/lootgame.db');

const BACKUP_DIR = process.env.NODE_ENV === 'production'
    ? '/app/data/backups'
    : path.join(__dirname, '../../data/backups');

const MAX_BACKUPS = 20; // Älteste werden automatisch gelöscht

// Tabellen, die ohne Fremdschlüssel-Risiko unabhängig exportiert/wiederhergestellt
// werden können (keine Spieler/Inventar/Cooldowns — die hängen per player_id zusammen).
const SELECTIVE_TABLES = ['items', 'messages', 'config', 'role_permissions'];

// Alle Tabellen, die für die Inspektor-Ansicht gezählt werden
const KNOWN_TABLES = [
    'players', 'inventory', 'items', 'messages', 'cooldowns',
    'config', 'dashboard_users', 'role_permissions', 'audit_log'
];

function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function createBackup(label = 'auto') {
    ensureBackupDir();

    if (!fs.existsSync(DB_PATH)) {
        throw new Error('Keine Datenbank-Datei zum Sichern gefunden');
    }

    const now = new Date();
    const ts  = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `backup_${ts}_${label}.db`;
    const filepath = path.join(BACKUP_DIR, filename);

    fs.copyFileSync(DB_PATH, filepath);
    cleanupOldBackups();

    return { filename, createdAt: now.getTime(), size: fs.statSync(filepath).size };
}

function listBackups() {
    ensureBackupDir();
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db'));

    return files.map(filename => {
        const filepath = path.join(BACKUP_DIR, filename);
        const stat = fs.statSync(filepath);
        return {
            filename,
            size: stat.size,
            createdAt: stat.mtimeMs
        };
    }).sort((a, b) => b.createdAt - a.createdAt);
}

function cleanupOldBackups() {
    const backups = listBackups();
    if (backups.length <= MAX_BACKUPS) return;

    const toDelete = backups.slice(MAX_BACKUPS);
    for (const backup of toDelete) {
        try {
            fs.unlinkSync(path.join(BACKUP_DIR, backup.filename));
        } catch {}
    }
}

function restoreBackup(filename) {
    ensureBackupDir();
    const filepath = path.join(BACKUP_DIR, filename);

    if (!fs.existsSync(filepath)) {
        throw new Error('Backup-Datei nicht gefunden');
    }

    // Sicherheits-Backup der aktuellen DB vor dem Restore
    createBackup('before-restore');

    fs.copyFileSync(filepath, DB_PATH);
    return true;
}

function deleteBackup(filename) {
    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) throw new Error('Backup-Datei nicht gefunden');
    fs.unlinkSync(filepath);
    return true;
}

function getBackupPath(filename) {
    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) throw new Error('Backup-Datei nicht gefunden');
    return filepath;
}

// ─── Backup-Inhalt einsehen (read-only, rührt nichts an) ──────────────────────
async function inspectBackup(filename) {
    const Database = require('better-sqlite3');
    const filepath = getBackupPath(filename);
    const backupDb = new Database(filepath, { readonly: true });

    const counts = {};
    for (const table of KNOWN_TABLES) {
        try {
            counts[table] = backupDb.prepare(`SELECT COUNT(*) as c FROM ${table}`).get().c;
        } catch {
            counts[table] = null; // Tabelle existierte in diesem Backup nicht
        }
    }
    backupDb.close();
    return counts;
}

// ─── Gezielt einzelne Tabellen aus einem Backup wiederherstellen ──────────────
async function restoreTablesFromBackup(filename, tables, schemaModule) {
    const Database = require('better-sqlite3');
    const valid = tables.filter(t => SELECTIVE_TABLES.includes(t));
    if (!valid.length) throw new Error('Keine gültigen Tabellen ausgewählt');

    const filepath = getBackupPath(filename);
    const backupDb = new Database(filepath, { readonly: true });

    const dump = {};
    for (const table of valid) {
        try {
            dump[table] = backupDb.prepare(`SELECT * FROM ${table}`).all();
        } catch {
            dump[table] = [];
        }
    }
    backupDb.close();

    createBackup('before-table-restore');

    const { run } = schemaModule;
    const restored = {};
    for (const [table, rows] of Object.entries(dump)) {
        run(`DELETE FROM ${table}`);
        if (rows.length) {
            const columns = Object.keys(rows[0]);
            for (const col of columns) {
                if (!/^[a-zA-Z0-9_]+$/.test(col)) throw new Error('Ungültiger Spaltenname: ' + col);
            }
            const placeholders = columns.map(() => '?').join(', ');
            for (const row of rows) {
                run(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`, columns.map(c => row[c]));
            }
        }
        restored[table] = rows.length;
    }
    return restored;
}

module.exports = {
    createBackup, listBackups, restoreBackup, deleteBackup, getBackupPath,
    inspectBackup, restoreTablesFromBackup, SELECTIVE_TABLES, KNOWN_TABLES,
    DB_PATH, BACKUP_DIR
};
