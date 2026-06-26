const { all, run, saveDb } = require('./schema');
const cache = require('./cache');

function getAllMessages() {
    const cached = cache.get(cache.KEYS.MESSAGES);
    if (cached) return cached;

    const rows = all(`SELECT type, map, text FROM messages ORDER BY type, map, id`);
    const result = { death: {}, map: {} };
    for (const row of rows) {
        if (!result[row.type]) result[row.type] = {};
        if (!result[row.type][row.map]) result[row.type][row.map] = [];
        result[row.type][row.map].push(row.text);
    }
    cache.set(cache.KEYS.MESSAGES, result);
    return result;
}

function getMessages(type, map) {
    const all_msgs = getAllMessages();
    const byType   = all_msgs[type] || {};
    const mapMsgs  = byType[map] || [];
    if (mapMsgs.length) return mapMsgs; // Map hat eigene Nachrichten -> Default wird NICHT mehr mit reingemischt
    const defMsgs = byType['Default'] || [];
    return defMsgs.length ? defMsgs : null;
}

function getRandomMessage(type, map) {
    const messages = getMessages(type, map);
    if (!messages || !messages.length) return null;
    return messages[Math.floor(Math.random() * messages.length)];
}

function setMessages(type, messagesObj) {
    run(`DELETE FROM messages WHERE type = ?`, [type]);
    for (const [map, texts] of Object.entries(messagesObj)) {
        if (!Array.isArray(texts)) continue;
        for (const text of texts) {
            if (text && text.trim()) {
                run(`INSERT INTO messages (type, map, text) VALUES (?, ?, ?)`, [type, map, text.trim()]);
            }
        }
    }
    saveDb();
    cache.invalidate(cache.KEYS.MESSAGES);
}

function countMessages() {
    const r = all(`SELECT type, COUNT(*) as c FROM messages GROUP BY type`);
    const result = {};
    for (const row of r) result[row.type] = row.c;
    return result;
}

module.exports = { getMessages, getAllMessages, getRandomMessage, setMessages, countMessages };