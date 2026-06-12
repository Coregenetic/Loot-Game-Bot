const { get, all, run } = require('./schema');

function getConfig(section) {
    const row = get(`SELECT value FROM config WHERE key = ?`, [section]);
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return row.value; }
}

function getAllConfig() {
    const rows = all(`SELECT key, value FROM config`);
    const result = {};
    for (const row of rows) {
        try { result[row.key] = JSON.parse(row.value); }
        catch { result[row.key] = row.value; }
    }
    return result;
}

function setConfig(section, value) {
    run(
        `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))`,
        [section, JSON.stringify(value)]
    );
}

function updateConfigField(section, field, value) {
    const current = getConfig(section) || {};
    current[field] = value;
    setConfig(section, current);
}

function getGeneral()      { return getConfig('General')      || {}; }
function getMaps()         { return getConfig('Maps')         || {}; }
function getLeveling()     { return getConfig('Leveling')     || {}; }
function getActiveEvents() { return getConfig('ActiveEvents') || {}; }

module.exports = {
    getConfig, getAllConfig, setConfig, updateConfigField,
    getGeneral, getMaps, getLeveling, getActiveEvents
};
