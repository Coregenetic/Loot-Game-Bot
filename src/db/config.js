const { getDb } = require('./schema');

// ─── Config lesen ─────────────────────────────────────────────────────────────

function getConfig(section) {
    const db = getDb();
    const row = db.prepare(`SELECT value FROM config WHERE key = ?`).get(section);
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return row.value; }
}

function getAllConfig() {
    const db = getDb();
    const rows = db.prepare(`SELECT key, value FROM config`).all();
    const result = {};
    for (const row of rows) {
        try { result[row.key] = JSON.parse(row.value); }
        catch { result[row.key] = row.value; }
    }
    return result;
}

// ─── Config schreiben ─────────────────────────────────────────────────────────

function setConfig(section, value) {
    const db = getDb();
    db.prepare(`
        INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, unixepoch())
    `).run(section, JSON.stringify(value));
}

function updateConfigField(section, field, value) {
    const current = getConfig(section) || {};
    current[field] = value;
    setConfig(section, current);
}

// ─── Shortcuts für häufig genutzte Config-Werte ───────────────────────────────

function getGeneral()       { return getConfig('General')       || {}; }
function getMaps()          { return getConfig('Maps')           || {}; }
function getLeveling()      { return getConfig('Leveling')       || {}; }
function getActiveEvents()  { return getConfig('ActiveEvents')   || {}; }

module.exports = {
    getConfig,
    getAllConfig,
    setConfig,
    updateConfigField,
    getGeneral,
    getMaps,
    getLeveling,
    getActiveEvents
};
