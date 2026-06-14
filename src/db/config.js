const { get: dbGet, all, run } = require('./schema');
const cache = require('./cache');

function getConfig(section) {
    const all_config = getAllConfig();
    return all_config[section] ?? null;
}

function getAllConfig() {
    const cached = cache.get(cache.KEYS.CONFIG);
    if (cached) return cached;

    const rows = all(`SELECT key, value FROM config`);
    const result = {};
    for (const row of rows) {
        try { result[row.key] = JSON.parse(row.value); }
        catch { result[row.key] = row.value; }
    }
    cache.set(cache.KEYS.CONFIG, result);
    return result;
}

function setConfig(section, value) {
    run(
        `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))`,
        [section, JSON.stringify(value)]
    );
    cache.invalidate(cache.KEYS.CONFIG);
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
