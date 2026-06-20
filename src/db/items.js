const { all, run } = require('./schema');
const cache = require('./cache');

function getAllItems() {
    const cached = cache.get(cache.KEYS.ITEMS);
    if (cached) return cached;

    const items = all(`SELECT * FROM items`);
    cache.set(cache.KEYS.ITEMS, items);
    return items;
}

function getKappaItems() {
    return getAllItems().filter(i => i.is_kappa === 1);
}

function getItemsForMap(mapName) {
    const items = getAllItems();
    return items.filter(item => {
        if (!item.map) return false;
        try {
            const maps = JSON.parse(item.map);
            if (Array.isArray(maps)) return maps.includes(mapName) || maps.includes('All');
            return maps === mapName || maps === 'All';
        } catch {
            return item.map === mapName || item.map === 'All';
        }
    });
}

function parseValue(v) {
    if (typeof v === 'number') return v;
    const s = String(v).replace(/[₽\s]/g, '').replace('Rubel', '').toLowerCase().trim();
    if (s.endsWith('b')) return Math.round(parseFloat(s) * 1e9);
    if (s.endsWith('m')) return Math.round(parseFloat(s) * 1e6);
    if (s.endsWith('k')) return Math.round(parseFloat(s) * 1e3);
    return parseInt(s) || 0;
}

function upsertItem(name, data) {
    const value   = parseValue(data.value);
    const newText = data.text || '';

    // Alten Text-Wert holen bevor wir überschreiben (für Inventar-Sync)
    const existing = all(`SELECT text FROM items WHERE name = ?`, [name]);
    const oldText  = existing.length ? existing[0].text : null;

    run(
        `INSERT INTO items (name, text, value, map, icon, is_kappa)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
             text = ?, value = ?, map = ?, icon = ?, is_kappa = ?`,
        [
            name,
            newText, value,
            Array.isArray(data.map) ? JSON.stringify(data.map) : (data.map || ''),
            data.icon || '', data.isKappa ? 1 : 0,
            newText, value,
            Array.isArray(data.map) ? JSON.stringify(data.map) : (data.map || ''),
            data.icon || '', data.isKappa ? 1 : 0
        ]
    );
    cache.invalidate(cache.KEYS.ITEMS);

    // Inventar aller Spieler aktualisieren — neuer Wert UND ggf. neuer Name
    const matchText = oldText || newText;
    if (matchText) {
        run(
            `UPDATE inventory SET value = ?, item_name = ? WHERE lower(item_name) = lower(?)`,
            [value, newText, matchText]
        );
    }
}

function deleteItem(name) {
    run(`DELETE FROM items WHERE name = ?`, [name]);
    cache.invalidate(cache.KEYS.ITEMS);
}

module.exports = { getAllItems, getKappaItems, getItemsForMap, upsertItem, deleteItem };