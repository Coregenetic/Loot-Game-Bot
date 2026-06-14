/**
 * Zentraler Logger — schreibt in Console UND broadcastet an WebSocket-Clients
 */

let wsBroadcast = null;
const logBuffer = []; // Letzten 200 Logs im RAM
const MAX_BUFFER = 200;

function setWsBroadcast(fn) {
    wsBroadcast = fn;
}

function log(level, category, message) {
    const entry = {
        ts:       new Date().toISOString(),
        level,    // 'INFO' | 'WARN' | 'ERROR' | 'CMD' | 'BOT' | 'API'
        category,
        message
    };

    // Console
    const prefix = `[${entry.ts.slice(11,19)}] [${level}]`;
    if (level === 'ERROR') console.error(prefix, message);
    else                   console.log(prefix, message);

    // Buffer
    logBuffer.push(entry);
    if (logBuffer.length > MAX_BUFFER) logBuffer.shift();

    // WebSocket Broadcast
    if (wsBroadcast) {
        try { wsBroadcast(JSON.stringify({ type: 'log', data: entry })); }
        catch {}
    }
}

const info  = (cat, msg) => log('INFO',  cat, msg);
const warn  = (cat, msg) => log('WARN',  cat, msg);
const error = (cat, msg) => log('ERROR', cat, msg);
const cmd   = (cat, msg) => log('CMD',   cat, msg);
const bot   = (cat, msg) => log('BOT',   cat, msg);
const api   = (cat, msg) => log('API',   cat, msg);

function getBuffer() { return [...logBuffer]; }

module.exports = { setWsBroadcast, info, warn, error, cmd, bot, api, getBuffer };
