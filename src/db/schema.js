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

        -- Ersetzt den früheren in-memory setTimeout für die Raid-Auflösung.
        -- Das Ergebnis (Survived/Loot/XP) steht schon beim !loot-Aufruf fest,
        -- wird aber erst hier "scharf geschaltet" wenn resolve_at erreicht ist.
        -- Überlebt Bot-Neustarts: ein periodischer Check holt überfällige Raids
        -- nach, statt dass sie beim Neustart einfach spurlos verschwinden.
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
            resolve_at  INTEGER NOT NULL,
            created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_pending_raids_resolve ON pending_raids(resolve_at);

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

    // Migration: last_seen Spalte nachrüsten (für Online-Status im Admin Panel)
    try {
        const cols = db.exec(`PRAGMA table_info(players)`);
        const hasLastSeen = cols.length > 0 && cols[0].values.some(row => row[1] === 'last_seen');
        if (!hasLastSeen) {
            db.run(`ALTER TABLE players ADD COLUMN last_seen INTEGER`);
            console.log('[DB] Migration: last_seen Spalte zur players Tabelle hinzugefügt.');
        }
    } catch (err) {
        console.error('[DB] Migration-Fehler (last_seen):', err.message);
    }

    // Migration: avatar_url Spalte nachrüsten (Twitch-Profilbild, gesetzt beim Player-Hub-Login)
    try {
        const cols = db.exec(`PRAGMA table_info(players)`);
        const hasAvatar = cols.length > 0 && cols[0].values.some(row => row[1] === 'avatar_url');
        if (!hasAvatar) {
            db.run(`ALTER TABLE players ADD COLUMN avatar_url TEXT`);
            console.log('[DB] Migration: avatar_url Spalte zur players Tabelle hinzugefügt.');
        }
    } catch (err) {
        console.error('[DB] Migration-Fehler (avatar_url):', err.message);
    }

    // Migration: category Spalte nachrüsten (für Item-Filter im Admin Panel)
    try {
        const cols = db.exec(`PRAGMA table_info(items)`);
        const hasCategory = cols.length > 0 && cols[0].values.some(row => row[1] === 'category');
        if (!hasCategory) {
            db.run(`ALTER TABLE items ADD COLUMN category TEXT`);
            console.log('[DB] Migration: category Spalte zur items Tabelle hinzugefügt.');
        }
    } catch (err) {
        console.error('[DB] Migration-Fehler (category):', err.message);
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
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash   TEXT NOT NULL,
            role            TEXT NOT NULL DEFAULT 'mod',
            failed_attempts INTEGER NOT NULL DEFAULT 0,
            locked_until    INTEGER NOT NULL DEFAULT 0,
            created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS dashboard_sessions (
            token_hash TEXT PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
            username   TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS role_permissions (
            role        TEXT PRIMARY KEY,
            permissions TEXT NOT NULL DEFAULT '[]',
            updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS audit_log (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            action   TEXT NOT NULL,
            details  TEXT,
            ts       INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);

        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
            username   TEXT NOT NULL,
            endpoint   TEXT NOT NULL UNIQUE,
            keys_json  TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        -- Komplett getrennt von dashboard_sessions! Das hier sind Zuschauer, die
        -- sich per Twitch-Login identifizieren, um IHRE EIGENEN Spieler-Daten zu
        -- sehen (Stash/Kappa/Inventar) — niemals Admin-Rechte, niemals verknüpft
        -- mit dashboard_users.
        CREATE TABLE IF NOT EXISTS player_sessions (
            token_hash    TEXT PRIMARY KEY,
            username      TEXT NOT NULL,
            twitch_user_id TEXT NOT NULL,
            expires_at    INTEGER NOT NULL,
            created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
    `);

    // Migration: role/lockout-Spalten nachrüsten falls dashboard_users bereits existierte
    const userCols = db.exec(`PRAGMA table_info(dashboard_users)`);
    const userColNames = userCols.length > 0 ? userCols[0].values.map(r => r[1]) : [];
    if (!userColNames.includes('role')) {
        db.run(`ALTER TABLE dashboard_users ADD COLUMN role TEXT NOT NULL DEFAULT 'mod'`);
        console.log('[DB] Migration: role Spalte zu dashboard_users hinzugefügt.');
    }
    if (!userColNames.includes('failed_attempts')) {
        db.run(`ALTER TABLE dashboard_users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0`);
        db.run(`ALTER TABLE dashboard_users ADD COLUMN locked_until INTEGER NOT NULL DEFAULT 0`);
        console.log('[DB] Migration: Lockout-Spalten zu dashboard_users hinzugefügt.');
    }

    // Migration: dashboard_sessions auf gehashte Tokens umstellen (Sicherheits-Upgrade).
    // Bricht bewusst alle aktiven Sessions einmalig — danach einmal neu einloggen.
    const sessCols = db.exec(`PRAGMA table_info(dashboard_sessions)`);
    const sessColNames = sessCols.length > 0 ? sessCols[0].values.map(r => r[1]) : [];
    if (sessCols.length > 0 && !sessColNames.includes('token_hash')) {
        db.run(`DROP TABLE dashboard_sessions`);
        db.run(`
            CREATE TABLE dashboard_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
                username   TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
        `);
        console.log('[DB] Migration: dashboard_sessions auf gehashte Tokens umgestellt (alle Sessions wurden zurückgesetzt).');
    }

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