const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/lootgame.db');

let db;

function getDb() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');   // bessere Performance bei gleichzeitigen Zugriffen
        db.pragma('foreign_keys = ON');
    }
    return db;
}

function initSchema() {
    const db = getDb();

    db.exec(`
        -- ─── Spieler ─────────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS players (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            username        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
            level           INTEGER NOT NULL DEFAULT 1,
            xp              INTEGER NOT NULL DEFAULT 0,
            prestige        INTEGER NOT NULL DEFAULT 0,
            has_kappa       INTEGER NOT NULL DEFAULT 0,   -- 0/1 Boolean
            raids_total     INTEGER NOT NULL DEFAULT 0,
            raids_survived  INTEGER NOT NULL DEFAULT 0,
            raids_died      INTEGER NOT NULL DEFAULT 0,
            created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
        );

        -- ─── Inventar ────────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS inventory (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            item_name   TEXT    NOT NULL,
            count       INTEGER NOT NULL DEFAULT 1,
            value       INTEGER NOT NULL DEFAULT 0,
            UNIQUE(player_id, item_name)
        );

        -- ─── Items Datenbank ─────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS items (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL UNIQUE,
            text        TEXT,
            value       INTEGER NOT NULL DEFAULT 0,
            map         TEXT,               -- JSON array oder single string
            icon        TEXT,
            is_kappa    INTEGER NOT NULL DEFAULT 0,
            tier        TEXT,
            created_at  INTEGER NOT NULL DEFAULT (unixepoch())
        );

        -- ─── Config ──────────────────────────────────────────────────────────────
        -- Key-Value Store — ersetzt game_config.json komplett
        CREATE TABLE IF NOT EXISTS config (
            key         TEXT PRIMARY KEY,
            value       TEXT NOT NULL,      -- JSON-encoded
            updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
        );

        -- ─── Cooldowns ───────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS cooldowns (
            player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            command     TEXT    NOT NULL,
            expires_at  INTEGER NOT NULL,   -- Unix timestamp
            PRIMARY KEY (player_id, command)
        );

        -- ─── Events ──────────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS events (
            type        TEXT    PRIMARY KEY,
            data        TEXT    NOT NULL DEFAULT '{}',   -- JSON
            expires_at  INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL DEFAULT (unixepoch())
        );

        -- ─── Prestige Pending (Bestätigungs-Fenster) ─────────────────────────────
        CREATE TABLE IF NOT EXISTS prestige_pending (
            player_id   INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
            started_at  INTEGER NOT NULL DEFAULT (unixepoch())
        );

        -- ─── Indizes für Performance ──────────────────────────────────────────────
        CREATE INDEX IF NOT EXISTS idx_inventory_player  ON inventory(player_id);
        CREATE INDEX IF NOT EXISTS idx_cooldowns_expires ON cooldowns(expires_at);
        CREATE INDEX IF NOT EXISTS idx_items_kappa       ON items(is_kappa);
    `);

    console.log('[DB] Schema initialisiert.');
}

module.exports = { getDb, initSchema };
