/**
 * Einfache In-Memory Token-Verwaltung für die Kappa-Übersicht.
 * Tokens sind 15 Minuten gültig und werden danach automatisch ungültig.
 */

const tokens = new Map(); // token -> { username, expiresAt }
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 Minuten

function generateKappaToken(username) {
    const token = [...Array(24)]
        .map(() => Math.random().toString(36)[2] || '0')
        .join('');

    tokens.set(token, {
        username: username.toLowerCase(),
        expiresAt: Date.now() + TOKEN_TTL_MS
    });

    // Alte Tokens aufräumen
    cleanupExpiredTokens();

    return token;
}

function validateKappaToken(token) {
    const entry = tokens.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        tokens.delete(token);
        return null;
    }
    return entry.username;
}

function cleanupExpiredTokens() {
    const now = Date.now();
    for (const [token, entry] of tokens.entries()) {
        if (now > entry.expiresAt) tokens.delete(token);
    }
}

module.exports = { generateKappaToken, validateKappaToken };
