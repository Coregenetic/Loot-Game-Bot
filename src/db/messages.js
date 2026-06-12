const { all, run, saveDb } = require('./schema');

// ─── Messages laden ───────────────────────────────────────────────────────────

function getMessages(type, map) {
    // Map-spezifische + Default Messages
    const mapMessages     = all(`SELECT text FROM messages WHERE type = ? AND map = ?`, [type, map]);
    const defaultMessages = all(`SELECT text FROM messages WHERE type = ? AND map = 'Default'`, [type]);

    const combined = [
        ...mapMessages.map(r => r.text),
        ...defaultMessages.map(r => r.text)
    ];

    return combined.length ? combined : null;
}

function getAllMessages() {
    const rows = all(`SELECT type, map, text FROM messages ORDER BY type, map, id`);
    // Als verschachteltes Objekt zurückgeben wie die JSON-Files
    const result = { exfil: {}, death: {} };
    for (const row of rows) {
        const type = row.type;
        const map  = row.map;
        if (!result[type]) result[type] = {};
        if (!result[type][map]) result[type][map] = [];
        result[type][map].push(row.text);
    }
    return result;
}

function getRandomMessage(type, map) {
    const messages = getMessages(type, map);
    if (!messages || !messages.length) return null;
    return messages[Math.floor(Math.random() * messages.length)];
}

function setMessages(type, messagesObj) {
    // Alle alten Messages dieses Typs löschen
    run(`DELETE FROM messages WHERE type = ?`, [type]);

    // Neue einfügen
    for (const [map, texts] of Object.entries(messagesObj)) {
        if (!Array.isArray(texts)) continue;
        for (const text of texts) {
            if (text && text.trim()) {
                run(`INSERT INTO messages (type, map, text) VALUES (?, ?, ?)`, [type, map, text.trim()]);
            }
        }
    }
    saveDb();
}

function countMessages() {
    const r = all(`SELECT type, COUNT(*) as c FROM messages GROUP BY type`);
    const result = {};
    for (const row of r) result[row.type] = row.c;
    return result;
}

module.exports = { getMessages, getAllMessages, getRandomMessage, setMessages, countMessages };
