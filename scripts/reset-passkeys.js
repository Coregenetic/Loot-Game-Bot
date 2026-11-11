/**
 * Notfall: Löscht alle Passkeys eines Dashboard-Kontos (z.B. PC defekt, Handy verloren).
 * Danach kann sich das Konto wieder mit dem Passwort anmelden und einen neuen Passkey einrichten.
 *
 * Aufruf auf dem Server:
 *   docker exec lootgame node scripts/reset-passkeys.js <benutzername>
 */
require('dotenv').config();
const { initSchema, initDashboardUsers } = require('../src/db/schema');
const { initPasskeys, deleteAllPasskeys } = require('../src/db/passkeys');
const { getUserByName, deleteUserSessions } = require('../src/db/users');
const { logAudit } = require('../src/db/audit');

async function main() {
    const username = process.argv[2];
    if (!username) {
        console.error('Aufruf: node scripts/reset-passkeys.js <benutzername>');
        process.exit(1);
    }
    await initSchema();
    await initDashboardUsers();
    initPasskeys();

    const user = getUserByName(username);
    if (!user) {
        console.error(`Benutzer "${username}" nicht gefunden.`);
        process.exit(1);
    }
    const removed = deleteAllPasskeys(user.id);
    deleteUserSessions(user.id);
    logAudit('cli', 'passkeys_reset', { username: user.username, removed });
    console.log(`✅ ${removed} Passkey(s) von "${user.username}" gelöscht, Sessions beendet.`);
}

main().catch(err => { console.error(err); process.exit(1); });
