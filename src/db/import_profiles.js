/**
 * Loot-Game Bot — Migrations-Script
 * Importiert alle alten JSON-Profile + items.json + game_config.json
 *
 * Aufruf: node src/db/import_profiles.js
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const PROFILES_DIR = process.env.LEGACY_PROFILES_DIR || './data/legacy_profiles';
const ITEMS_PATH   = process.env.LEGACY_ITEMS_PATH   || './data/legacy_items/items.json';
const CONFIG_PATH  = process.env.LEGACY_CONFIG_PATH  || './data/legacy_config/game_config.json';

let imported = 0, failed = 0;

function log(msg, level = 'INFO') {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[${ts}] [${level}] ${msg}`);
}

function parseProfile(filePath) {
    try {
        const raw  = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);

        if (!data.Inventory && !data.Level) {
            return {
                level: 1, xp: 0, prestige: 0, hasKappa: false,
                raidsTotal: 0, raidsSurvived: 0, raidsDied: 0,
                inventory: data
            };
        }
        return {
            level:         data.Level         || 1,
            xp:            data.XP             || 0,
            prestige:      data.Prestige        || 0,
            hasKappa:      data.HasKappa        || false,
            raidsTotal:    data.RaidsTotal      || 0,
            raidsSurvived: data.RaidsSurvived   || 0,
            raidsDied:     data.RaidsDied       || 0,
            inventory:     data.Inventory       || {}
        };
    } catch { return null; }
}

function parseValue(val) {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    const str = String(val).replace(/[₽\s]/g, '').toLowerCase();
    if (str.endsWith('b')) return Math.round(parseFloat(str) * 1_000_000_000);
    if (str.endsWith('m')) return Math.round(parseFloat(str) * 1_000_000);
    if (str.endsWith('k')) return Math.round(parseFloat(str) * 1_000);
    return parseInt(str) || 0;
}

async function main() {
    log('═══════════════════════════════════════');
    log('  Loot-Game Bot — Migrations-Script');
    log('═══════════════════════════════════════');

    const { initSchema, getDb, run, get, saveDb } = require('./schema');
    await initSchema();
    const db = await getDb();

    // ─── Items importieren ────────────────────────────────────────────────────
    if (fs.existsSync(ITEMS_PATH)) {
        const items = JSON.parse(fs.readFileSync(ITEMS_PATH, 'utf8'));
        const keys  = Object.keys(items);
        log(`${keys.length} Items gefunden — importiere...`);

        for (const [name, data] of Object.entries(items)) {
            db.run(
                `INSERT OR REPLACE INTO items (name, text, value, map, icon, is_kappa)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    name,
                    data.text  || '',
                    parseValue(data.value),
                    Array.isArray(data.map) ? JSON.stringify(data.map) : (data.map || ''),
                    data.icon  || '',
                    data.isKappa ? 1 : 0
                ]
            );
        }
        saveDb();
        log(`${keys.length} Items importiert.`);
    } else {
        log(`items.json nicht gefunden: ${ITEMS_PATH}`, 'WARN');
    }

    // ─── Config importieren ───────────────────────────────────────────────────
    if (fs.existsSync(CONFIG_PATH)) {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        for (const [key, val] of Object.entries(config)) {
            db.run(
                `INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`,
                [key, JSON.stringify(val)]
            );
        }
        saveDb();
        log('Config importiert.');
    } else {
        log('game_config.json nicht gefunden — lade Standard-Config...', 'WARN');
        const defaults = {
            General: {
                CooldownSeconds: 600, CooldownMessageDelaySeconds: 300,
                DoubleLootChance: 0.03, KappaDoubleLootBonus: 0.10,
                MinExfilSeconds: 5, MaxExfilSeconds: 15, SurvivalChance: 0.75,
                XPDivisor: 1000
            },
            Maps: {
                Customs: 10, Factory: 8, "Ground Zero": 9, Interchange: 10,
                Icebreaker: 5, Lighthouse: 7, Reserve: 8, Shoreline: 7,
                Streets: 9, Lab: 3, Woods: 10, "The Labyrinth": 2
            },
            ActiveEvents: {
                ForcedMap: { MapName: "", ExpiresAt: 0 },
                DoubleLootOverride: { Chance: 0, ExpiresAt: 0 },
                XPBoost: { Multiplier: 1, ExpiresAt: 0 }
            },
            Leveling: {
                XPMultiplier: 1.5, XPBase: 350, PrestigeXPMalus: 0.1,
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
        for (const [key, val] of Object.entries(defaults)) {
            db.run(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`,
                [key, JSON.stringify(val)]);
        }
        saveDb();
        log('Standard-Config eingefügt.');
    }

    // ─── Spielerprofile importieren ───────────────────────────────────────────
    if (!fs.existsSync(PROFILES_DIR)) {
        log(`Profilordner nicht gefunden: ${PROFILES_DIR}`, 'WARN');
    } else {
        const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json'));
        log(`${files.length} Profile gefunden — starte Import...`);

        for (const file of files) {
            const username = path.basename(file, '.json').toLowerCase();
            const profile  = parseProfile(path.join(PROFILES_DIR, file));

            if (!profile) { failed++; continue; }

            try {
                db.run(
                    `INSERT OR IGNORE INTO players
                        (username, level, xp, prestige, has_kappa, raids_total, raids_survived, raids_died)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [username, profile.level, profile.xp, profile.prestige,
                     profile.hasKappa ? 1 : 0, profile.raidsTotal,
                     profile.raidsSurvived, profile.raidsDied]
                );

                const playerRow = db.exec(`SELECT id FROM players WHERE username = '${username.replace(/'/g,"''")}'`);
                if (!playerRow[0]?.values?.length) continue;
                const playerId = playerRow[0].values[0][0];

                for (const [itemName, itemData] of Object.entries(profile.inventory || {})) {
                    if (!itemName || typeof itemData !== 'object') continue;
                    db.run(
                        `INSERT OR REPLACE INTO inventory (player_id, item_name, count, value)
                         VALUES (?, ?, ?, ?)`,
                        [playerId, itemName,
                         itemData.Count || itemData.count || 1,
                         itemData.Value || itemData.value || 0]
                    );
                }

                imported++;
                if (imported % 50 === 0) log(`${imported}/${files.length} importiert...`);
            } catch (err) {
                log(`Fehler bei ${username}: ${err.message}`, 'ERROR');
                failed++;
            }
        }

        saveDb();
    }

    log('═══════════════════════════════════════');
    log(`✓ Spieler importiert : ${imported}`);
    log(`✗ Fehler             : ${failed}`);
    log('Migration abgeschlossen.');
    log('═══════════════════════════════════════');
}

main().catch(err => {
    console.error('[FATAL]', err);
    process.exit(1);
});
