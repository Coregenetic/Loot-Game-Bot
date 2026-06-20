const initSqlJs = require('sql.js');
const path = require('path');
const fs   = require('fs');

const DB_PATH = process.env.NODE_ENV === 'production'
    ? '/app/data/lootgame.db'
    : path.join(__dirname, '../../data/lootgame.db');

let db = null;

// ─── DB laden oder neu erstellen ─────────────────────────────────────────────
async function getDb() {
    if (db) return db;

    const SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    // WAL-Mode nicht verfügbar in sql.js, aber auto-save reicht
    return db;
}

// ─── DB auf Disk speichern ────────────────────────────────────────────────────
function saveDb() {
    if (!db) return;
    const data = db.export();
    const dir  = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ─── Hilfsfunktionen die better-sqlite3 API nachahmen ────────────────────────
// Damit der restliche Code möglichst gleich bleibt

function run(sql, params = {}) {
    db.run(sql, params);
    saveDb();
}

function get(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row;
    }
    stmt.free();
    return null;
}

function all(sql, params = []) {
    const results = [];
    const stmt = db.prepare(sql);
    stmt.bind(params);
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}

function exec(sql) {
    db.run(sql);
    saveDb();
}

// ─── Schema erstellen ─────────────────────────────────────────────────────────
async function initSchema() {
    await getDb();

    db.run(`
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
            text        TEXT,
            value       INTEGER NOT NULL DEFAULT 0,
            map         TEXT,
            icon        TEXT,
            is_kappa    INTEGER NOT NULL DEFAULT 0,
            tier        TEXT,
            created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS config (
            key         TEXT PRIMARY KEY,
            value       TEXT NOT NULL,
            updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS cooldowns (
            player_id   INTEGER NOT NULL,
            command     TEXT    NOT NULL,
            expires_at  INTEGER NOT NULL,
            PRIMARY KEY (player_id, command),
            FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS events (
            type        TEXT    PRIMARY KEY,
            data        TEXT    NOT NULL DEFAULT '{}',
            expires_at  INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS prestige_pending (
            player_id   INTEGER PRIMARY KEY,
            started_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_inventory_player  ON inventory(player_id);
        CREATE INDEX IF NOT EXISTS idx_cooldowns_expires ON cooldowns(expires_at);
        CREATE INDEX IF NOT EXISTS idx_items_kappa       ON items(is_kappa);
    `);

    // Migration: item_key Spalte nachrüsten falls Tabelle bereits existierte
    try {
        const cols = db.exec(`PRAGMA table_info(inventory)`);
        const hasItemKey = cols.length > 0 && cols[0].values.some(row => row[1] === 'item_key');
        if (!hasItemKey) {
            db.run(`ALTER TABLE inventory ADD COLUMN item_key TEXT`);
            console.log('[DB] Migration: item_key Spalte zur inventory Tabelle hinzugefügt.');
        }
    } catch (err) {
        console.error('[DB] Migration-Fehler (item_key):', err.message);
    }

    saveDb();
    console.log('[DB] Schema initialisiert.');
}

module.exports = { getDb, saveDb, initSchema, run, get, all, exec };

// ─── Dashboard Users Schema ───────────────────────────────────────────────────
async function initDashboardUsers() {
    const db = await getDb();
    db.run(`
        CREATE TABLE IF NOT EXISTS dashboard_users (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS dashboard_sessions (
            token      TEXT PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
            username   TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
    `);
    saveDb();
}

module.exports.initDashboardUsers = initDashboardUsers;

// ─── Messages Schema ──────────────────────────────────────────────────────────
async function initMessages() {
    const db = await getDb();
    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            type     TEXT NOT NULL,  -- 'exfil' oder 'death'
            map      TEXT NOT NULL DEFAULT 'Default',
            text     TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_messages_type_map ON messages(type, map);
    `);
    saveDb();
}

module.exports.initMessages = initMessages;
