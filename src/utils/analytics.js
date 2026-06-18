/**
 * Command Analytics Logger
 * Schreibt alle Command-Aufrufe in eine append-only JSON-Datei auf dem Volume.
 * Überlebt jeden Neustart — unabhängig von der RAM-DB.
 */

const fs   = require('fs');
const path = require('path');

const LOG_PATH = process.env.NODE_ENV === 'production'
    ? '/app/data/command_log.jsonl'
    : path.join(__dirname, '../../data/command_log.jsonl');

// Sicherstellen dass der Ordner existiert
const dir = path.dirname(LOG_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

/**
 * Einen Command-Aufruf loggen
 * @param {string} command  - z.B. '!loot'
 * @param {string} username - Twitch-Username
 * @param {string} channel  - Twitch-Channel
 * @param {object} data     - Zusätzliche Daten (map, item, value, survived, etc.)
 */
function logCommand(command, username, channel, data = {}) {
    try {
        const entry = JSON.stringify({
            ts:      Date.now(),
            cmd:     command,
            user:    username.toLowerCase(),
            channel: channel.replace('#', '').toLowerCase(),
            ...data
        });
        fs.appendFileSync(LOG_PATH, entry + '\n', 'utf8');
    } catch (err) {
        // Logging-Fehler niemals den Bot crashen lassen
        console.error('[ANALYTICS] Logging-Fehler:', err.message);
    }
}

/**
 * Alle Logs lesen und als Array zurückgeben
 * @param {number} limit - Maximale Anzahl (0 = alle)
 */
function readLogs(limit = 0) {
    try {
        if (!fs.existsSync(LOG_PATH)) return [];
        const lines = fs.readFileSync(LOG_PATH, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map(line => {
                try { return JSON.parse(line); }
                catch { return null; }
            })
            .filter(Boolean);
        return limit > 0 ? lines.slice(-limit) : lines;
    } catch {
        return [];
    }
}

/**
 * Stats aus den Logs berechnen
 */
function calcStats(logs) {
    const stats = {
        total:        logs.length,
        byCommand:    {},
        byUser:       {},
        byHour:       new Array(24).fill(0),
        byDay:        {},
        lootStats: {
            total:    0,
            survived: 0,
            died:     0,
            totalValue: 0,
            topItems: {}
        }
    };

    for (const entry of logs) {
        // Per Command
        stats.byCommand[entry.cmd] = (stats.byCommand[entry.cmd] || 0) + 1;

        // Per User
        stats.byUser[entry.user] = (stats.byUser[entry.user] || 0) + 1;

        // Per Stunde
        const hour = new Date(entry.ts).getHours();
        stats.byHour[hour]++;

        // Per Tag
        const day = new Date(entry.ts).toLocaleDateString('de-DE');
        stats.byDay[day] = (stats.byDay[day] || 0) + 1;

        // Loot-spezifisch
        if (entry.cmd === '!loot') {
            stats.lootStats.total++;
            if (entry.survived === true)  stats.lootStats.survived++;
            if (entry.survived === false) stats.lootStats.died++;
            if (entry.itemValue)          stats.lootStats.totalValue += entry.itemValue;
            if (entry.itemName) {
                stats.lootStats.topItems[entry.itemName] =
                    (stats.lootStats.topItems[entry.itemName] || 0) + 1;
            }
        }
    }

    return stats;
}

module.exports = { logCommand, readLogs, calcStats };
