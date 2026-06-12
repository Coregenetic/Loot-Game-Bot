// ─── Währungs-Formatierung ────────────────────────────────────────────────────

function formatCurrency(value) {
    const n = Number(value) || 0;
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '') + 'B ₽';
    if (n >= 1_000_000)     return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M ₽';
    if (n >= 1_000)         return (n / 1_000).toFixed(1).replace(/\.?0+$/, '') + 'K ₽';
    return `${n} ₽`;
}

// ─── Kürzel für Leaderboard ───────────────────────────────────────────────────

function formatShort(value) {
    const n = Number(value) || 0;
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (n >= 1_000_000)     return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (n >= 1_000)         return (n / 1_000).toFixed(1).replace(/\.?0+$/, '') + 'K';
    return String(n);
}

// ─── Zeit-Formatierung ────────────────────────────────────────────────────────

function formatDuration(seconds) {
    const s = Math.floor(seconds);
    if (s < 60)   return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// ─── Level-Berechnung ─────────────────────────────────────────────────────────

function calcXPForLevel(level, settings) {
    if (level <= 1) return 0;
    const { XPBase = 350, XPMultiplier = 1.5 } = settings;
    return Math.floor(XPBase * Math.pow(level - 1, XPMultiplier) + (level - 1) * XPBase);
}

function calcLevelFromXP(totalXP, settings) {
    let level = 1;
    while (totalXP >= calcXPForLevel(level + 1, settings)) level++;
    return level;
}

function getRankName(level, ranks) {
    if (!ranks) return 'Scav';
    let rankName = 'Scav';
    let highest  = -1;
    for (const [key, name] of Object.entries(ranks)) {
        const rankLevel = parseInt(key);
        if (!isNaN(rankLevel) && level >= rankLevel && rankLevel > highest) {
            highest  = rankLevel;
            rankName = name;
        }
    }
    return rankName;
}

module.exports = { formatCurrency, formatShort, formatDuration, calcXPForLevel, calcLevelFromXP, getRankName };
