const { get, all, run, saveDb, getDb } = require('./schema');

// ─── Spieler laden / anlegen ──────────────────────────────────────────────────

function getPlayer(username) {
    return get(
        `SELECT * FROM players WHERE lower(username) = lower(?)`,
        [username.toLowerCase()]
    );
}

async function getOrCreatePlayer(username) {
    const db = require('./schema');
    const existing = getPlayer(username);
    if (existing) return existing;

    run(
        `INSERT OR IGNORE INTO players (username, level, xp, prestige, has_kappa, raids_total, raids_survived, raids_died) VALUES (?, 1, 0, 0, 0, 0, 0, 0)`,
        [username.toLowerCase()]
    );

    return getPlayer(username);
}

function updatePlayer(username, fields) {
    const db = require('./schema');
    const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
    const vals = [...Object.values(fields), username.toLowerCase()];
    run(
        `UPDATE players SET ${sets}, updated_at = strftime('%s','now') WHERE lower(username) = lower(?)`,
        vals
    );
}

// ─── Inventar ─────────────────────────────────────────────────────────────────

function getInventory(playerId) {
    return all(
        `SELECT item_name, count, value FROM inventory
         WHERE player_id = ?
         ORDER BY (count * value) DESC`,
        [playerId]
    );
}

function addOrUpdateInventoryItem(playerId, itemName, count, value, itemKey = null) {
    run(
        `INSERT INTO inventory (player_id, item_name, item_key, count, value)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(player_id, item_name) DO UPDATE SET
             count = count + ?,
             value = ?,
             item_key = COALESCE(?, item_key)`,
        [playerId, itemName, itemKey, count, value, count, value, itemKey]
    );
}

function removeInventoryItem(playerId, itemName, count = 1) {
    const item = get(
        `SELECT count FROM inventory WHERE player_id = ? AND lower(item_name) = lower(?)`,
        [playerId, itemName]
    );
    if (!item) return false;

    if (item.count <= count) {
        run(`DELETE FROM inventory WHERE player_id = ? AND lower(item_name) = lower(?)`,
            [playerId, itemName]);
    } else {
        run(`UPDATE inventory SET count = count - ? WHERE player_id = ? AND lower(item_name) = lower(?)`,
            [count, playerId, itemName]);
    }
    return true;
}

function clearInventory(playerId) {
    run(`DELETE FROM inventory WHERE player_id = ?`, [playerId]);
}

function getStashValue(playerId) {
    const result = get(
        `SELECT COALESCE(SUM(count * value), 0) AS total FROM inventory WHERE player_id = ?`,
        [playerId]
    );
    return result ? result.total : 0;
}

// ─── Cooldowns ────────────────────────────────────────────────────────────────

function isOnCooldown(playerId, command) {
    const row = get(
        `SELECT expires_at FROM cooldowns WHERE player_id = ? AND command = ?`,
        [playerId, command]
    );
    if (!row) return false;
    const now = Math.floor(Date.now() / 1000);
    if (row.expires_at <= now) {
        run(`DELETE FROM cooldowns WHERE player_id = ? AND command = ?`, [playerId, command]);
        return false;
    }
    return row.expires_at;
}

function setCooldown(playerId, command, seconds) {
    const expiresAt = Math.floor(Date.now() / 1000) + seconds;
    run(
        `INSERT OR REPLACE INTO cooldowns (player_id, command, expires_at) VALUES (?, ?, ?)`,
        [playerId, command, expiresAt]
    );
}

function getRemainingCooldown(playerId, command) {
    const expiresAt = isOnCooldown(playerId, command);
    if (!expiresAt) return 0;
    return Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

function getLeaderboard(limit = 5) {
    return all(
        `SELECT p.id, p.username, p.level, p.prestige, p.has_kappa,
                COALESCE(SUM(i.count * i.value), 0) AS stash_value
         FROM players p
         LEFT JOIN inventory i ON i.player_id = p.id
         GROUP BY p.id
         ORDER BY p.prestige DESC, p.level DESC, stash_value DESC
         LIMIT ?`,
        [limit]
    );
}

module.exports = {
    getPlayer, getOrCreatePlayer, updatePlayer,
    getInventory, addOrUpdateInventoryItem, removeInventoryItem,
    clearInventory, getStashValue,
    isOnCooldown, setCooldown, getRemainingCooldown,
    getLeaderboard
};
