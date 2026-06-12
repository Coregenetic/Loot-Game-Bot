const { all, run } = require('./schema');

function getAllItems() {
    return all(`SELECT * FROM items`);
}

function getKappaItems() {
    return all(`SELECT * FROM items WHERE is_kappa = 1`);
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
            // UPDATE values
            data.text || '', data.value || 0,
            Array.isArray(data.map) ? JSON.stringify(data.map) : (data.map || ''),
            data.icon || '', data.isKappa ? 1 : 0
        ]
    );
}

function deleteItem(name) {
    run(`DELETE FROM items WHERE name = ?`, [name]);
}

module.exports = { getAllItems, getKappaItems, getItemsForMap, upsertItem, deleteItem };
