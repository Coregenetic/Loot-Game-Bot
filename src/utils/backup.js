/**
 * Backup-System für die sql.js Datenbank.
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

module.exports = {
    createBackup, listBackups, restoreBackup, deleteBackup, getBackupPath,
    DB_PATH, BACKUP_DIR
};
