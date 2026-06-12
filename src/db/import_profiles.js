/**
 * ============================================================
 * Loot-Game Bot — Migrations-Script
 * Importiert alle alten JSON-Profile + items.json + game_config.json
 * in die neue SQLite Datenbank.
 *
 * Aufruf: node src/db/import_profiles.js
 * ============================================================
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { getDb, initSchema } = require('./schema');

const PROFILES_DIR  = process.env.LEGACY_PROFILES_DIR  || './data/legacy_profiles';
const ITEMS_PATH    = process.env.LEGACY_ITEMS_PATH    || './data/legacy_items/items.json';
const CONFIG_PATH   = process.env.LEGACY_CONFIG_PATH   || './data/legacy_config/game_config.json';

// ─── Logging ─────────────────────────────────────────────────────────────────
let imported = 0, skipped = 0, failed = 0;

function log(msg, level = 'INFO') {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[${ts}] [${level}] ${msg}`);
}

// ─── Spielerprofil laden ──────────────────────────────────────────────────────
function parseProfile(filePath) {
    try {
        const raw  = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);

        // Altes Format: reines Inventory-Dictionary
        if (!data.Inventory && !data.Level) {
            return {
                level: 1, xp: 0, prestige: 0, hasKappa: false,
                raidsTotal: 0, raidsSurvived: 0, raidsDied: 0,
                inventory: data
            };
        }

        // Neues Format: PlayerProfile Objekt
        return {
            level:        data.Level        || 1,
            xp:           data.XP           || 0,
            prestige:     data.Prestige      || 0,
            hasKappa:     data.HasKappa      || false,
            raidsTotal:   data.RaidsTotal    || 0,
            raidsSurvived:data.RaidsSurvived || 0,
            raidsDied:    data.RaidsDied     || 0,
            inventory:    data.Inventory     || {}
        };
    } catch (err) {
        return null;
    }
}

// ─── Spieler importieren ──────────────────────────────────────────────────────
function importProfiles(db) {
    if (!fs.existsSync(PROFILES_DIR)) {
        log(`Profilordner nicht gefunden: ${PROFILES_DIR}`, 'WARN');
        return;
    }

    const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json'));
    log(`${files.length} Profile gefunden — starte Import...`);

    const insertPlayer = db.prepare(`
        INSERT OR IGNORE INTO players
            (username, level, xp, prestige, has_kappa, raids_total, raids_survived, raids_died)
        VALUES
            (@username, @level, @xp, @prestige, @hasKappa, @raidsTotal, @raidsSurvived, @raidsDied)
    `);

    const insertItem = db.prepare(`
        INSERT OR REPLACE INTO inventory (player_id, item_name, count, value)
        VALUES (@playerId, @itemName, @count, @value)
    `);

    const getPlayer = db.prepare(`SELECT id FROM players WHERE username = ? COLLATE NOCASE`);

    const importOne = db.transaction((username, profile) => {
        insertPlayer.run({
            username,
            level:         profile.level,
            xp:            profile.xp,
            prestige:      profile.prestige,
            hasKappa:      profile.hasKappa ? 1 : 0,
            raidsTotal:    profile.raidsTotal,
            raidsSurvived: profile.raidsSurvived,
            raidsDied:     profile.raidsDied
        });

        const player = getPlayer.get(username);
        if (!player) return;

        for (const [itemName, itemData] of Object.entries(profile.inventory || {})) {
            if (!itemName || typeof itemData !== 'object') continue;
            insertItem.run({
                playerId: player.id,
                itemName,
                count: itemData.Count || itemData.count || 1,
                value: itemData.Value || itemData.value || 0
            });
        }
    });

    for (const file of files) {
        const username = path.basename(file, '.json');
        const profile  = parseProfile(path.join(PROFILES_DIR, file));

        if (!profile) {
            log(`Fehler beim Parsen: ${file}`, 'WARN');
            failed++;
            continue;
        }

        try {
            importOne(username, profile);
            imported++;
            if (imported % 50 === 0) log(`${imported}/${files.length} importiert...`);
        } catch (err) {
            log(`Fehler bei ${username}: ${err.message}`, 'ERROR');
            failed++;
        }
    }
}

// ─── Items importieren ────────────────────────────────────────────────────────
function importItems(db) {
    if (!fs.existsSync(ITEMS_PATH)) {
        log(`items.json nicht gefunden: ${ITEMS_PATH}`, 'WARN');
        return;
    }

    const raw   = fs.readFileSync(ITEMS_PATH, 'utf8');
    const items = JSON.parse(raw);
    const keys  = Object.keys(items);

    log(`${keys.length} Items gefunden — importiere...`);

    const insert = db.prepare(`
        INSERT OR REPLACE INTO items (name, text, value, map, icon, is_kappa)
        VALUES (@name, @text, @value, @map, @icon, @isKappa)
    `);

    const importAllItems = db.transaction(() => {
        for (const [name, data] of Object.entries(items)) {
            insert.run({
                name,
                text:    data.text   || '',
                value:   parseValue(data.value),
                map:     Array.isArray(data.map)
                            ? JSON.stringify(data.map)
                            : (data.map || ''),
                icon:    data.icon   || '',
                isKappa: data.isKappa ? 1 : 0
            });
        }
    });

    importAllItems();
    log(`Items importiert: ${keys.length}`);
}

// ─── Config importieren ───────────────────────────────────────────────────────
function importConfig(db) {
    if (!fs.existsSync(CONFIG_PATH)) {
        log(`game_config.json nicht gefunden: ${CONFIG_PATH}`, 'WARN');
        log('Lade Standard-Config...');
        insertDefaultConfig(db);
        return;
    }

    const raw    = fs.readFileSync(CONFIG_PATH, 'utf8');
    const config = JSON.parse(raw);

    log('game_config.json gefunden — importiere...');

    const insert = db.prepare(`
        INSERT OR REPLACE INTO config (key, value) VALUES (@key, @value)
    `);

    const importConf = db.transaction(() => {
        for (const [section, data] of Object.entries(config)) {
            insert.run({ key: section, value: JSON.stringify(data) });
        }
    });

    importConf();
    log('Config importiert.');
}

function insertDefaultConfig(db) {
    const defaults = {
        General: {
            CooldownSeconds: 600,
            CooldownMessageDelaySeconds: 300,
            DoubleLootChance: 0.03,
            KappaDoubleLootBonus: 0.10,
            MinExfilSeconds: 5,
            MaxExfilSeconds: 15,
            SurvivalChance: 0.75
        },
        Maps: {
            Customs: 10, Factory: 8, "Ground Zero": 9,
            Interchange: 10, Icebreaker: 5, Lighthouse: 7,
            Reserve: 8, Shoreline: 7, Streets: 9,
            Lab: 3, Woods: 10, "The Labyrinth": 2
        },
        ActiveEvents: {
            ForcedMap: { MapName: "", ExpiresAt: 0 },
            DoubleLootOverride: { Chance: 0, ExpiresAt: 0 },
            XPBoost: { Multiplier: 1, ExpiresAt: 0 }
        },
        Leveling: {
            XPMultiplier: 1.5,
            XPBase: 350,
            PrestigeXPMalus: 0.1,
            Ranks: {
                "1": "Timmy", "5": "Wanna-be Camper", "10": "BUSCHBEWOHNER",
                "15": "KISTENKRABBLER", "20": "Lootstaubsauger",
                "25": "TÜRRAHMEN-TAKTIKER", "30": "EXTRACT-LURKER",
                "35": "CHAD IN AUSBILDUNG", "40": "ROGUE-KILLER",
                "45": "BOSSJÄGER", "50": "TARKOV-TYRANN",
                "55": "LABS-PHANTOM", "60": "TARKOV ELITE",
                "65": "GEIST VON NORVINSK", "70": "EFT Legende"
            }
        }
    };

    const insert = db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES (@key, @value)`);
    const run = db.transaction(() => {
        for (const [key, val] of Object.entries(defaults)) {
            insert.run({ key, value: JSON.stringify(val) });
        }
    });
    run();
    log('Standard-Config eingefügt.');
}

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────
function parseValue(val) {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    const str = String(val).replace(/[₽\s]/g, '').toLowerCase();
    if (str.endsWith('b')) return Math.round(parseFloat(str) * 1_000_000_000);
    if (str.endsWith('m')) return Math.round(parseFloat(str) * 1_000_000);
    if (str.endsWith('k')) return Math.round(parseFloat(str) * 1_000);
    return parseInt(str) || 0;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
    log('═══════════════════════════════════════');
    log('  Loot-Game Bot — Migrations-Script');
    log('═══════════════════════════════════════');

    // Schema sicherstellen
    initSchema();
    const db = getDb();

    // Import
    importItems(db);
    importConfig(db);
    importProfiles(db);

    // Ergebnis
    log('═══════════════════════════════════════');
    log(`✓ Spieler importiert : ${imported}`);
    log(`✓ Übersprungen       : ${skipped}`);
    log(`✗ Fehler             : ${failed}`);
    log('Migration abgeschlossen.');
    log('═══════════════════════════════════════');
}

main();
