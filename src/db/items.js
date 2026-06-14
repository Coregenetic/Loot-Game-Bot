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

function upsertItem(name, data) {
    run(
        `INSERT INTO items (name, text, value, map, icon, is_kappa)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
             text = ?, value = ?, map = ?, icon = ?, is_kappa = ?`,
        [
            name,
            data.text || '', data.value || 0,
            Array.isArray(data.map) ? JSON.stringify(data.map) : (data.map || ''),
            data.icon || '', data.isKappa ? 1 : 0,
            data.text || '', data.value || 0,
            Array.isArray(data.map) ? JSON.stringify(data.map) : (data.map || ''),
            data.icon || '', data.isKappa ? 1 : 0
        ]
    );
    cache.invalidate(cache.KEYS.ITEMS);
}

function deleteItem(name) {
    run(`DELETE FROM items WHERE name = ?`, [name]);
    cache.invalidate(cache.KEYS.ITEMS);
}

module.exports = { getAllItems, getKappaItems, getItemsForMap, upsertItem, deleteItem };
