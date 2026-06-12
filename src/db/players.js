const { getDb } = require('./schema');

// ─── Spieler laden / anlegen ──────────────────────────────────────────────────

function getPlayer(username) {
    const db = getDb();
    return db.prepare(`
        SELECT * FROM players WHERE username = ? COLLATE NOCASE
    `).get(username.toLowerCase());
}

function getOrCreatePlayer(username) {
    const db = getDb();
    const existing = getPlayer(username);
    if (existing) return existing;

    db.prepare(`
        INSERT OR IGNORE INTO players (username) VALUES (?)
    `).run(username.toLowerCase());

    return getPlayer(username);
}

function updatePlayer(username, fields) {
    const db = getDb();
    const sets = Object.keys(fields).map(k => `${k} = @${k}`).join(', ');
    db.prepare(`
        UPDATE players SET ${sets}, updated_at = unixepoch() WHERE username = ? COLLATE NOCASE
    `).run({ ...fields, username: username.toLowerCase() });
}

// ─── Inventar ─────────────────────────────────────────────────────────────────

function getInventory(playerId) {
    const db = getDb();
    return db.prepare(`
        SELECT item_name, count, value FROM inventory
        WHERE player_id = ?
        ORDER BY (count * value) DESC
    `).all(playerId);
}

function addOrUpdateInventoryItem(playerId, itemName, count, value) {
    const db = getDb();
    db.prepare(`
        INSERT INTO inventory (player_id, item_name, count, value)
        VALUES (@playerId, @itemName, @count, @value)
        ON CONFLICT(player_id, item_name) DO UPDATE SET
            count = count + @count,
            value = @value
    `).run({ playerId, itemName, count, value });
}

function removeInventoryItem(playerId, itemName, count = 1) {
    const db = getDb();
    const item = db.prepare(`
        SELECT count FROM inventory WHERE player_id = ? AND item_name = ? COLLATE NOCASE
    `).get(playerId, itemName);

    if (!item) return false;

    if (item.count <= count) {
        db.prepare(`DELETE FROM inventory WHERE player_id = ? AND item_name = ? COLLATE NOCASE`)
          .run(playerId, itemName);
    } else {
        db.prepare(`UPDATE inventory SET count = count - ? WHERE player_id = ? AND item_name = ? COLLATE NOCASE`)
          .run(count, playerId, itemName);
    }
    return true;
}

function clearInventory(playerId) {
    const db = getDb();
    db.prepare(`DELETE FROM inventory WHERE player_id = ?`).run(playerId);
}

function getStashValue(playerId) {
    const db = getDb();
    const result = db.prepare(`
        SELECT COALESCE(SUM(count * value), 0) AS total FROM inventory WHERE player_id = ?
    `).get(playerId);
    return result.total;
}

// ─── Cooldowns ────────────────────────────────────────────────────────────────

function isOnCooldown(playerId, command) {
    const db = getDb();
    const row = db.prepare(`
        SELECT expires_at FROM cooldowns WHERE player_id = ? AND command = ?
    `).get(playerId, command);

    if (!row) return false;
    if (row.expires_at <= Math.floor(Date.now() / 1000)) {
        db.prepare(`DELETE FROM cooldowns WHERE player_id = ? AND command = ?`).run(playerId, command);
        return false;
    }
    return row.expires_at;
}

function setCooldown(playerId, command, seconds) {
    const db = getDb();
    const expiresAt = Math.floor(Date.now() / 1000) + seconds;
    db.prepare(`
        INSERT OR REPLACE INTO cooldowns (player_id, command, expires_at) VALUES (?, ?, ?)
    `).run(playerId, command, expiresAt);
}

function getRemainingCooldown(playerId, command) {
    const expiresAt = isOnCooldown(playerId, command);
    if (!expiresAt) return 0;
    return Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

function getLeaderboard(limit = 5) {
    const db = getDb();
    const players = db.prepare(`
        SELECT p.id, p.username, p.level, p.prestige, p.has_kappa,
               COALESCE(SUM(i.count * i.value), 0) AS stash_value
        FROM players p
        LEFT JOIN inventory i ON i.player_id = p.id
        GROUP BY p.id
        ORDER BY p.prestige DESC, p.level DESC, stash_value DESC
        LIMIT ?
    `).all(limit);
    return players;
}

module.exports = {
    getPlayer,
    getOrCreatePlayer,
    updatePlayer,
    getInventory,
    addOrUpdateInventoryItem,
    removeInventoryItem,
    clearInventory,
    getStashValue,
    isOnCooldown,
    setCooldown,
    getRemainingCooldown,
    getLeaderboard
};
