/**
 * Datenbankschicht — better-sqlite3 (synchron, direkt auf Disk).
 * Vorher: sql.js (in-memory, manuell auf Disk speichern).
 * Die öffentliche API (run/get/all) ist identisch geblieben,
 * saveDb() ist jetzt eine No-Op (Writes gehen sofort auf Disk).
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs   = require('fs');

const DB_PATH = process.env.NODE_ENV === 'production'
    ? '/app/data/lootgame.db'
    : path.join(__dirname, '../../data/lootgame.db');

let db = null;

function getOrOpenDb() {
    if (db) return db;
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');  // besser als sql.js: echte Crash-Sicherheit
    db.pragma('foreign_keys = ON');
    return db;
}

// ─── Öffentliche API (identisch zu vorher) ────────────────────────────────────

function run(sql, params = []) {
    return getOrOpenDb().prepare(sql).run(params);
}

function get(sql, params = []) {
    return getOrOpenDb().prepare(sql).get(params) || null;
}

function all(sql, params = []) {
    return getOrOpenDb().prepare(sql).all(params);
}

// No-Op — better-sqlite3 schreibt synchron direkt auf Disk
function saveDb() {}

// Für Backup-Funktion — echte Datei kopieren statt export()
function exportDb() {
    const d = getOrOpenDb();
    d.pragma('wal_checkpoint(FULL)');
    return fs.readFileSync(DB_PATH);
}

// ─── Migrations-Hilfsfunktion ─────────────────────────────────────────────────
function hasColumn(table, column) {
    const cols = getOrOpenDb().pragma(`table_info(${table})`);
    return cols.some(row => row.name === column);
}

function hasTable(table) {
    return !!getOrOpenDb().prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get([table]);
}

// ─── Schema erstellen ─────────────────────────────────────────────────────────
async function initSchema() {
    const d = getOrOpenDb();

    d.exec(`
        CREATE TABLE IF NOT EXISTS players (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            username        TEXT    NOT NULL UNIQUE,
            level           INTEGER NOT NULL DEFAULT 1,
            xp              INTEGER NOT NULL DEFAULT 0,
            prestige        INTEGER NOT NULL DEFAULT 0,
            has_kappa       INTEGER NOT NULL DEFAULT 0,
            raids_total     INTEGER NOT NULL DEFAULT 0,
            raids_survived  INTEGER NOT NULL DEFAULT 0,
            raids_died      INTEGER NOT NULL DEFAULT 0,
            balance         INTEGER NOT NULL DEFAULT 0,
            created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS inventory (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id   INTEGER NOT NULL,
            item_name   TEXT    NOT NULL,
            item_key    TEXT,
            count       INTEGER NOT NULL DEFAULT 1,
            value       INTEGER NOT NULL DEFAULT 0,
            UNIQUE(player_id, item_name),
            FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS items (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL UNIQUE,
            value       INTEGER NOT NULL DEFAULT 0,
            icon        TEXT,
            map         TEXT,
            category    TEXT
        );

        CREATE TABLE IF NOT EXISTS config (
            key         TEXT    NOT NULL PRIMARY KEY,
            value       TEXT    NOT NULL,
            updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS cooldowns (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id   INTEGER NOT NULL,
            command     TEXT    NOT NULL,
            expires_at  INTEGER NOT NULL,
            UNIQUE(player_id, command),
            FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_cooldowns_expires ON cooldowns(expires_at);

        CREATE TABLE IF NOT EXISTS pending_raids (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id   INTEGER NOT NULL,
            username    TEXT    NOT NULL,
            channel     TEXT    NOT NULL,
            map         TEXT,
            survived    INTEGER NOT NULL,
            loot_json   TEXT,
            xp_gain     INTEGER NOT NULL DEFAULT 0,
            new_level   INTEGER,
            old_level   INTEGER,
            has_kappa   INTEGER NOT NULL DEFAULT 0,
            squad_window_id INTEGER,
            resolve_at  INTEGER NOT NULL,
            created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_pending_raids_resolve ON pending_raids(resolve_at);

        CREATE TABLE IF NOT EXISTS kappa_progress (
            player_id   INTEGER NOT NULL PRIMARY KEY,
            token       TEXT,
            FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS player_sessions (
            token_hash    TEXT PRIMARY KEY,
            username      TEXT NOT NULL,
            twitch_user_id TEXT NOT NULL,
            expires_at    INTEGER NOT NULL,
            created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
    `);

    // Migrations
    const migrations = [
        ['players',      'last_seen',   `ALTER TABLE players ADD COLUMN last_seen INTEGER`],
        ['players',      'avatar_url',  `ALTER TABLE players ADD COLUMN avatar_url TEXT`],
        ['players',      'display_name',`ALTER TABLE players ADD COLUMN display_name TEXT`],
        ['players',      'balance',     `ALTER TABLE players ADD COLUMN balance INTEGER NOT NULL DEFAULT 0`],
        ['pending_raids','squad_window_id', `ALTER TABLE pending_raids ADD COLUMN squad_window_id INTEGER`],
        ['items',        'category',    `ALTER TABLE items ADD COLUMN category TEXT`],
    ];

    for (const [table, column, sql] of migrations) {
        try {
            if (!hasColumn(table, column)) {
                d.exec(sql);
                console.log(`[DB] Migration: ${column} Spalte zur ${table} Tabelle hinzugefügt.`);
            }
        } catch (err) {
            console.error(`[DB] Migration-Fehler (${column}):`, err.message);
        }
    }

    console.log('[DB] Schema initialisiert.');
}

async function initDashboardUsers() {
    const d = getOrOpenDb();

    d.exec(`
        CREATE TABLE IF NOT EXISTS dashboard_users (
            username    TEXT    NOT NULL PRIMARY KEY,
            password    TEXT    NOT NULL,
            role        TEXT    NOT NULL DEFAULT 'mod',
            permissions TEXT    NOT NULL DEFAULT '[]',
            locked_until INTEGER,
            failed_attempts INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS dashboard_sessions (
            token_hash  TEXT    NOT NULL PRIMARY KEY,
            username    TEXT    NOT NULL,
            expires_at  INTEGER NOT NULL,
            created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS role_permissions (
            role        TEXT    NOT NULL PRIMARY KEY,
            permissions TEXT    NOT NULL DEFAULT '[]'
        );

        CREATE TABLE IF NOT EXISTS audit_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            username    TEXT    NOT NULL,
            action      TEXT    NOT NULL,
            details     TEXT,
            ts          INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS squads (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            leader_username TEXT NOT NULL,
            icon            TEXT NOT NULL DEFAULT '🎯',
            color           TEXT NOT NULL DEFAULT '#10b981',
            created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS squad_members (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            squad_id     INTEGER NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
            username     TEXT NOT NULL,
            status       TEXT NOT NULL DEFAULT 'pending',
            invited_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            responded_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS squad_raid_windows (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            squad_id   INTEGER NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
            channel    TEXT NOT NULL,
            opens_at   INTEGER NOT NULL,
            closes_at  INTEGER NOT NULL,
            resolved   INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS squad_raid_participants (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            window_id INTEGER NOT NULL REFERENCES squad_raid_windows(id) ON DELETE CASCADE,
            player_id INTEGER NOT NULL,
            username  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS squad_raid_history (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            squad_id     INTEGER NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
            map          TEXT,
            survived     INTEGER NOT NULL,
            participants TEXT NOT NULL,
            resolved_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_squad_raid_history_squad ON squad_raid_history(squad_id);
    `);

    // Migrations für squads
    const squadMigrations = [
        ['squads', 'config_overrides', `ALTER TABLE squads ADD COLUMN config_overrides TEXT`],
        ['squads', 'icon',  `ALTER TABLE squads ADD COLUMN icon TEXT NOT NULL DEFAULT '🎯'`],
        ['squads', 'color', `ALTER TABLE squads ADD COLUMN color TEXT NOT NULL DEFAULT '#10b981'`],
    ];

    for (const [table, column, sql] of squadMigrations) {
        try {
            if (!hasColumn(table, column)) {
                d.exec(sql);
                console.log(`[DB] Migration: ${column} Spalte zur ${table} Tabelle hinzugefügt.`);
            }
        } catch (err) {
            console.error(`[DB] Migration-Fehler (${column}):`, err.message);
        }
    }

    // squad_raid_history Tabelle nachrüsten falls sie fehlt
    if (!hasTable('squad_raid_history')) {
        d.exec(`
            CREATE TABLE IF NOT EXISTS squad_raid_history (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                squad_id     INTEGER NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
                map          TEXT,
                survived     INTEGER NOT NULL,
                participants TEXT NOT NULL,
                resolved_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
            CREATE INDEX IF NOT EXISTS idx_squad_raid_history_squad ON squad_raid_history(squad_id);
        `);
        console.log('[DB] Migration: squad_raid_history Tabelle hinzugefügt.');
    }
}

async function initMessages() {
    getOrOpenDb().exec(`
        CREATE TABLE IF NOT EXISTS bot_messages (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            key         TEXT    NOT NULL UNIQUE,
            value       TEXT    NOT NULL,
            updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
    `);
}

module.exports = {
    run, get, all,
    saveDb, exportDb,
    initSchema, initDashboardUsers, initMessages,
    getOrOpenDb
};
