/**
 * Hetzner API Integration — Server-Status, Metriken und Quick Controls
 * für das Admin Panel. Metriken (CPU/RAM/Disk) kommen direkt von der
 * Hetzner Cloud API, kein Extra-Agent auf dem Server nötig.
 */
const express = require('express');
const router  = express.Router();
const { requirePermission, requireSuperadmin } = require('../middleware/permission');

const HETZNER_API = 'https://api.hetzner.cloud/v1';

function hetznerHeaders() {
    return {
        'Authorization': `Bearer ${process.env.HETZNER_API_TOKEN}`,
        'Content-Type': 'application/json'
    };
}

// ─── Server-Status + Basis-Infos ─────────────────────────────────────────────
router.get('/status', requirePermission('server:manage'), async (req, res) => {
    try {
        const serverId = process.env.HETZNER_SERVER_ID;
        if (!serverId || !process.env.HETZNER_API_TOKEN) {
            return res.status(503).json({ error: 'Hetzner API nicht konfiguriert.' });
        }

        const r = await fetch(`${HETZNER_API}/servers/${serverId}`, {
            headers: hetznerHeaders()
        });
        if (!r.ok) return res.status(r.status).json({ error: 'Hetzner API Fehler: ' + r.status });

        const { server } = await r.json();
        res.json({
            id:          server.id,
            name:        server.name,
            status:      server.status,          // running, off, rebooting, ...
            ipv4:        server.public_net?.ipv4?.ip || null,
            serverType:  server.server_type?.name || null,
            cores:       server.server_type?.cores || null,
            memory:      server.server_type?.memory || null,  // GB
            disk:        server.server_type?.disk || null,    // GB
            location:    server.datacenter?.location?.city || null,
            created:     server.created,
            includedTraffic: server.server_type?.included_traffic || null,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── CPU/Netzwerk-Metriken (letzte 5 Minuten) ────────────────────────────────
router.get('/metrics', requirePermission('server:manage'), async (req, res) => {
    try {
        const serverId = process.env.HETZNER_SERVER_ID;
        if (!serverId || !process.env.HETZNER_API_TOKEN) {
            return res.status(503).json({ error: 'Hetzner API nicht konfiguriert.' });
        }

        const end   = new Date();
        const start = new Date(end.getTime() - 5 * 60 * 1000);
        const params = new URLSearchParams({
            type:  'cpu,network',
            start: start.toISOString(),
            end:   end.toISOString(),
            step:  '60'
        });

        const r = await fetch(`${HETZNER_API}/servers/${serverId}/metrics?${params}`, {
            headers: hetznerHeaders()
        });
        if (!r.ok) return res.status(r.status).json({ error: 'Hetzner Metrics Fehler: ' + r.status });

        const { metrics } = await r.json();

        // Letzten CPU-Wert extrahieren
        const cpuSeries = metrics?.time_series?.['cpu']?.values || [];
        const lastCpu   = cpuSeries.length ? cpuSeries[cpuSeries.length - 1][1] : null;

        res.json({
            cpu:       lastCpu !== null ? parseFloat(parseFloat(lastCpu).toFixed(1)) : null,
            updatedAt: end.toISOString()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Bot-Container neu starten (kein Server-Neustart) ─────────────────────────
router.post('/restart-bot', requirePermission('server:manage'), async (req, res) => {
    try {
        const { exec } = require('child_process');
        exec('docker restart lootgame', (err, stdout, stderr) => {
            if (err) return res.status(500).json({ error: stderr || err.message });
            res.json({ success: true, message: 'Bot-Container wird neu gestartet...' });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Server neu starten (Hetzner API, nur Superadmin) ────────────────────────
router.post('/reboot', requireSuperadmin, async (req, res) => {
    try {
        const serverId = process.env.HETZNER_SERVER_ID;
        const r = await fetch(`${HETZNER_API}/servers/${serverId}/actions/reboot`, {
            method: 'POST',
            headers: hetznerHeaders()
        });
        if (!r.ok) return res.status(r.status).json({ error: 'Hetzner Reboot Fehler: ' + r.status });
        res.json({ success: true, message: 'Server wird neu gestartet...' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
