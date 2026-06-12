const LootGameAPI = (() => {

    function getToken() {
        return localStorage.getItem('lootgame_session_token') || '';
    }

    function getUsername() {
        return localStorage.getItem('lootgame_username') || '';
    }

    function isLoggedIn() {
        return !!getToken();
    }

    function logout() {
        const token = getToken();
        if (token) {
            fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'x-session-token': token }
            }).catch(() => {});
        }
        localStorage.removeItem('lootgame_session_token');
        localStorage.removeItem('lootgame_username');
        window.location.href = '/login.html';
    }

    async function request(method, path, body = null) {
        const token = getToken();
        const opts  = {
            method,
            headers: {
                'Content-Type':    'application/json',
                'x-session-token': token
            }
        };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(path, opts);

        if (res.status === 401) {
            // Session abgelaufen — zum Login
            localStorage.removeItem('lootgame_session_token');
            window.location.href = '/login.html';
            return;
        }

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || 'HTTP ' + res.status);
        }
        return res.json();
    }

    const get   = (path)       => request('GET',    path);
    const put   = (path, body) => request('PUT',    path, body);
    const patch = (path, body) => request('PATCH',  path, body);
    const del   = (path)       => request('DELETE', path);

    async function checkConnection() {
        try {
            const data = await fetch('/health').then(r => r.json());
            return { ok: true, uptime: data.uptime };
        } catch { return { ok: false }; }
    }

    async function changePassword(oldPassword, newPassword) {
        return request('POST', '/api/auth/change-password', { oldPassword, newPassword });
    }

    const config = {
        getAll:     ()      => get('/api/config'),
        getSection: (s)     => get('/api/config/' + s),
        setSection: (s, v)  => put('/api/config/' + s, v)
    };
    const items = {
        getAll:  ()           => get('/api/items'),
        upsert:  (name, data) => put('/api/items/' + encodeURIComponent(name), data),
        delete:  (name)       => del('/api/items/' + encodeURIComponent(name))
    };
    const players = {
        getAll:      ()       => get('/api/players'),
        get:         (user)   => get('/api/players/' + user),
        update:      (user,d) => patch('/api/players/' + user, d),
        leaderboard: (n)      => get('/api/players/leaderboard/top?limit=' + (n||5))
    };
    const events = {
        getAll:       ()          => get('/api/events'),
        setForcedMap: (map, mins) => put('/api/events/forcedmap',  { mapName: map, durationMinutes: mins }),
        setDoubleLoot:(c, mins)   => put('/api/events/doubleloot', { chance: c, durationMinutes: mins }),
        setXPBoost:   (m, mins)   => put('/api/events/xpboost',    { multiplier: m, durationMinutes: mins }),
        clear:        (type)      => del('/api/events/' + type)
    };

    return {
        getToken, getUsername, isLoggedIn, logout, checkConnection, changePassword,
        config, items, players, events
    };
})();

// Auf jeder Seite außer login.html prüfen ob eingeloggt
if (!window.location.pathname.includes('login')) {
    if (!LootGameAPI.isLoggedIn()) {
        window.location.href = '/login.html';
    }
}
