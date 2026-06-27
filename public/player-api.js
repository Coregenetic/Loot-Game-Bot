/**
 * Eigener, schlanker API-Client für die Spieler-Seiten (Player Hub/Inventar).
 * Komplett getrennt vom Dashboard-Client (api-client.js) — eigener
 * localStorage-Key, eigener Header, keine Berührung mit Admin-Sessions.
 */
const PlayerAPI = (() => {
    const TOKEN_KEY = 'lootgame_player_token';

    function getToken() {
        return localStorage.getItem(TOKEN_KEY) || '';
    }

    function setToken(t) {
        localStorage.setItem(TOKEN_KEY, t);
    }

    function clearToken() {
        localStorage.removeItem(TOKEN_KEY);
    }

    function isLoggedIn() {
        return !!getToken();
    }

    async function call(path, options = {}) {
        const res = await fetch(path, {
            ...options,
            headers: { ...(options.headers || {}), 'x-player-token': getToken() }
        });
        if (res.status === 401) {
            clearToken();
            window.location.href = '/player-login.html';
            throw new Error('Session abgelaufen');
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Anfrage fehlgeschlagen');
        return data;
    }

    async function logout() {
        try { await call('/api/player-auth/logout', { method: 'POST' }); } catch {}
        clearToken();
        window.location.href = '/player-login.html';
    }

    return {
        getToken, setToken, clearToken, isLoggedIn, logout,
        me:           () => call('/api/player-auth/me'),
        myStats:      () => call('/api/player-auth/my-stats'),
        myInventory:  () => call('/api/player-auth/my-inventory'),
        leaderboard:  (limit) => call('/api/player-auth/leaderboard' + (limit ? '?limit=' + limit : ''))
    };
})();