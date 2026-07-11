/**
 * Echtzeit-Systemmetriken direkt aus dem Linux-Kernel.
 * Liest /proc/stat für CPU, os-Modul für RAM, df für Disk.
 * Sendet alle 2 Sekunden via WebSocket an das Admin Panel.
 */
const os   = require('os');
const fs   = require('fs');
const { execSync } = require('child_process');
const logger = require('./logger');

let prevCpuTimes = null;
let metricsInterval = null;

// ─── CPU-Auslastung via /proc/stat (wie top/htop) ────────────────────────────
function readCpuTimes() {
    try {
        const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
        const parts = line.split(/\s+/).slice(1).map(Number);
        const [user, nice, system, idle, iowait, irq, softirq, steal] = parts;
        const total = user + nice + system + idle + (iowait||0) + (irq||0) + (softirq||0) + (steal||0);
        return { total, idle: idle + (iowait||0) };
    } catch {
        return null;
    }
}

function calcCpuPercent() {
    const curr = readCpuTimes();
    if (!curr || !prevCpuTimes) {
        prevCpuTimes = curr;
        return null;
    }
    const deltaTotal = curr.total - prevCpuTimes.total;
    const deltaIdle  = curr.idle  - prevCpuTimes.idle;
    prevCpuTimes = curr;
    if (deltaTotal === 0) return 0;
    return parseFloat((100 * (1 - deltaIdle / deltaTotal)).toFixed(1));
}

// ─── RAM via os-Modul ─────────────────────────────────────────────────────────
function getRamStats() {
    const total = os.totalmem();
    const free  = os.freemem();
    const used  = total - free;
    return {
        usedMb:  Math.round(used  / 1024 / 1024),
        totalMb: Math.round(total / 1024 / 1024),
        pct:     parseFloat((100 * used / total).toFixed(1))
    };
}

// ─── Disk via df ─────────────────────────────────────────────────────────────
function getDiskStats() {
    try {
        const out = execSync("df -k /app/data | awk 'NR==2{print $3, $4, $2}'")
            .toString().trim().split(/\s+/).map(Number);
        const [used, avail, size] = [out[0]*1024, out[1]*1024, out[2]*1024];
        return {
            usedGb:  parseFloat((used  / 1e9).toFixed(1)),
            freeGb:  parseFloat((avail / 1e9).toFixed(1)),
            totalGb: parseFloat((size  / 1e9).toFixed(1)),
            pct:     parseFloat((100 * used / size).toFixed(1))
        };
    } catch {
        return null;
    }
}

// ─── Node.js Heap ─────────────────────────────────────────────────────────────
function getHeapStats() {
    const m = process.memoryUsage();
    return {
        usedMb:  Math.round(m.heapUsed  / 1024 / 1024),
        totalMb: Math.round(m.heapTotal / 1024 / 1024),
        rssMb:   Math.round(m.rss       / 1024 / 1024),
        pct:     parseFloat((100 * m.heapUsed / m.heapTotal).toFixed(1))
    };
}

// ─── Netzwerk via /proc/net/dev ───────────────────────────────────────────────
let prevNetStats = null;

function getNetStats() {
    try {
        const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n');
        // eth0 oder das erste nicht-lo Interface finden
        const iface = lines.find(l => l.includes('eth0') || l.includes('ens')) || '';
        const parts = iface.trim().split(/\s+/);
        if (parts.length < 10) return null;
        const rx = parseInt(parts[1]); // bytes received
        const tx = parseInt(parts[9]); // bytes sent
        const now = Date.now();

        if (!prevNetStats) {
            prevNetStats = { rx, tx, ts: now };
            return { rxKbs: 0, txKbs: 0 };
        }

        const dtSec = (now - prevNetStats.ts) / 1000;
        const rxKbs = parseFloat(((rx - prevNetStats.rx) / 1024 / dtSec).toFixed(1));
        const txKbs = parseFloat(((tx - prevNetStats.tx) / 1024 / dtSec).toFixed(1));
        prevNetStats = { rx, tx, ts: now };
        return { rxKbs: Math.max(0, rxKbs), txKbs: Math.max(0, txKbs) };
    } catch {
        return null;
    }
}

// ─── Alles zusammen, alle 2 Sekunden via WebSocket senden ─────────────────────
function startMetricsBroadcast() {
    if (metricsInterval) return;

    // Ersten CPU-Sample nehmen (braucht 2 Messungen für Delta)
    prevCpuTimes = readCpuTimes();
    prevNetStats = null;

    metricsInterval = setInterval(() => {
        try {
            const { broadcast } = require('./wsHub');
            const cpu  = calcCpuPercent();
            const ram  = getRamStats();
            const disk = getDiskStats();
            const heap = getHeapStats();
            const net  = getNetStats();

            broadcast({
                type: 'server_metrics',
                ts:   Date.now(),
                cpu,
                ram,
                disk,
                heap,
                net
            });
        } catch (err) {
            logger.error('METRICS', err.message);
        }
    }, 2000);

    logger.info('METRICS', 'Echtzeit-Systemmetriken gestartet (2s Intervall)');
}

function stopMetricsBroadcast() {
    if (metricsInterval) { clearInterval(metricsInterval); metricsInterval = null; }
}

module.exports = { startMetricsBroadcast, stopMetricsBroadcast };
