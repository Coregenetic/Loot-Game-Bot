/**
 * Loot-Game API Client
 * Wird von allen Game Center HTML-Files genutzt.
 * Speichert URL + Token in localStorage.
 */

const LootGameAPI = (() => {

    const STORAGE_KEY = 'lootgame_api_config';

    // ─── Config lesen/schreiben ───────────────────────────────────────────────
    function getApiConfig() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
        } catch { return {}; }
    }

    function saveApiConfig(url, token) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ url: url.replace(/\/$/, ''), token }));
    }

    function getBaseUrl() { return getApiConfig().url || ''; }
    function getToken()   { return getApiConfig().token || ''; }
    function isConfigured() { return !!(getBaseUrl() && getToken()); }

    // ─── HTTP Helpers ─────────────────────────────────────────────────────────
    async function request(method, path, body = null) {
        const url   = getBaseUrl() + path;
        const token = getToken();

        const opts = {
            method,
            headers: {
                'Content-Type':      'application/json',
                'x-dashboard-token': token
            }
        };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(url, opts);
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
    }

    const get    = (path)        => request('GET',    path);
    const put    = (path, body)  => request('PUT',    path, body);
    const patch  = (path, body)  => request('PATCH',  path, body);
    const del    = (path)        => request('DELETE', path);
    const post   = (path, body)  => request('POST',   path, body);

    // ─── Health Check ─────────────────────────────────────────────────────────
    async function checkConnection() {
        if (!isConfigured()) return { ok: false, reason: 'not_configured' };
        try {
            const data = await fetch(getBaseUrl() + '/health').then(r => r.json());
            return { ok: true, uptime: data.uptime };
        } catch {
            return { ok: false, reason: 'unreachable' };
        }
    }

    // ─── Auth ─────────────────────────────────────────────────────────────────
    async function login(url, password) {
        const baseUrl = url.replace(/\/$/, '');
        const res = await fetch(baseUrl + '/api/auth', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ password })
        });
        const data = await res.json();
        if (data.success) {
            saveApiConfig(baseUrl, password);
            return true;
        }
        return false;
    }

    // ─── Config API ───────────────────────────────────────────────────────────
    const config = {
        getAll:    ()           => get('/api/config'),
        getSection:(section)    => get(`/api/config/${section}`),
        setSection:(section, v) => put(`/api/config/${section}`, v)
    };

    // ─── Items API ────────────────────────────────────────────────────────────
    const items = {
        getAll:  ()           => get('/api/items'),
        upsert:  (name, data) => put(`/api/items/${encodeURIComponent(name)}`, data),
        delete:  (name)       => del(`/api/items/${encodeURIComponent(name)}`)
    };

    // ─── Players API ──────────────────────────────────────────────────────────
    const players = {
        getAll:  ()       => get('/api/players'),
        get:     (user)   => get(`/api/players/${user}`),
        update:  (user,d) => patch(`/api/players/${user}`, d),
        leaderboard: (n)  => get(`/api/players/leaderboard/top?limit=${n||5}`)
    };

    // ─── Events API ───────────────────────────────────────────────────────────
    const events = {
        getAll:       ()    => get('/api/events'),
        setForcedMap: (map, mins) => put('/api/events/forcedmap',  { mapName: map, durationMinutes: mins }),
        setDoubleLoot:(chance, mins) => put('/api/events/doubleloot', { chance, durationMinutes: mins }),
        setXPBoost:   (mult, mins)   => put('/api/events/xpboost',    { multiplier: mult, durationMinutes: mins }),
        clear:        (type) => del(`/api/events/${type}`)
    };

    // ─── Connection Status UI (optional) ─────────────────────────────────────
    function renderConnectionBadge(elementId) {
        const el = document.getElementById(elementId);
        if (!el) return;

        if (!isConfigured()) {
            el.innerHTML = `<span style="color:#f59e0b;">⚠ API nicht konfiguriert</span>`;
            return;
        }

        checkConnection().then(result => {
            if (result.ok) {
                el.innerHTML = `<span style="color:#10b981;">● Bot verbunden</span>`;
            } else {
                el.innerHTML = `<span style="color:#ef4444;">● Bot nicht erreichbar</span>`;
            }
        });
    }

    return {
        // Config
        getApiConfig, saveApiConfig, getBaseUrl, getToken, isConfigured,
        // Auth
        login, checkConnection,
        // API
        config, items, players, events,
        // UI
        renderConnectionBadge
    };

})();
