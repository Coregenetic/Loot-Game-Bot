/**
 * Einfacher In-Memory Cache mit Invalidierung.
 * Der Bot liest Config/Items/Messages aus diesem Cache —
 * die API leert den Cache bei Schreibvorgängen.
 */

const cache = new Map();

function get(key) {
    return cache.get(key) ?? null;
}

function set(key, value) {
    cache.set(key, value);
}

function invalidate(key) {
    cache.delete(key);
}

function invalidateAll() {
    cache.clear();
}

// Cache-Keys
const KEYS = {
    CONFIG:   'config_all',
    ITEMS:    'items_all',
    MESSAGES: 'messages_all'
};

module.exports = { get, set, invalidate, invalidateAll, KEYS };
