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
    let s = String(v).replace(/[₽\s]/g, '').replace(/Rubel/gi, '').trim();

    // Suffixe (K/M/B) zuerst prüfen — vor dem Entfernen der Punkte
    const lower = s.toLowerCase();
    if (lower.endsWith('b')) return Math.round(parseFloat(s.replace(',', '.')) * 1e9);
    if (lower.endsWith('m')) return Math.round(parseFloat(s.replace(',', '.')) * 1e6);
    if (lower.endsWith('k')) return Math.round(parseFloat(s.replace(',', '.')) * 1e3);

    // Deutsches Format erkennen: Punkte als Tausender-Trenner (z.B. "2.000.000")
    // Erkennungsmerkmal: mehrere Punkte, oder ein Punkt gefolgt von genau 3 Ziffern ohne weiteren Punkt danach
    const dotGroups = s.match(/\./g);
    if (dotGroups && dotGroups.length >= 1) {
        // Prüfen ob es wie ein Tausender-Format aussieht: Ziffern.Ziffern(.Ziffern)*
        const isThousandsFormat = /^\d{1,3}(\.\d{3})+$/.test(s);
        if (isThousandsFormat) {
            s = s.replace(/\./g, '');
        }
    }

    // Komma als Dezimaltrennzeichen behandeln falls noch vorhanden (z.B. "2,5" -> 2.5, aber hier meist nicht relevant)
    s = s.replace(',', '.');

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