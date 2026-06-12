const { getDb } = require('./schema');

function getAllItems() {
    const db = getDb();
    return db.prepare(`SELECT * FROM items`).all();
}

function getKappaItems() {
    const db = getDb();
    return db.prepare(`SELECT * FROM items WHERE is_kappa = 1`).all();
}

function getItemsForMap(mapName) {
    const db = getDb();
    const all = getAllItems();
    return all.filter(item => {
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
    const db = getDb();
    db.prepare(`
        INSERT INTO items (name, text, value, map, icon, is_kappa)
        VALUES (@name, @text, @value, @map, @icon, @isKappa)
        ON CONFLICT(name) DO UPDATE SET
            text     = @text,
            value    = @value,
            map      = @map,
            icon     = @icon,
            is_kappa = @isKappa
    `).run({
        name,
        text:    data.text    || '',
        value:   data.value   || 0,
        map:     Array.isArray(data.map) ? JSON.stringify(data.map) : (data.map || ''),
        icon:    data.icon    || '',
        isKappa: data.isKappa ? 1 : 0
    });
}

function deleteItem(name) {
    const db = getDb();
    db.prepare(`DELETE FROM items WHERE name = ?`).run(name);
}

module.exports = { getAllItems, getKappaItems, getItemsForMap, upsertItem, deleteItem };
