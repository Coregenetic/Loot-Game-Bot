/**
 * Einmaliges Migrations-Script — setzt Rollen für bestehende Accounts.
 * Aufruf (z.B. via `fly ssh console`):
 *   node scripts/migrate-roles.js
 *
 * Passt die Zuordnung unten an, falls eure Usernamen abweichen.
 */
require('dotenv').config();
const { initSchema, initDashboardUsers } = require('../src/db/schema');
const { userExists, setUserRole } = require('../src/db/users');

const ASSIGNMENTS = [
    { username: 'core',  role: 'superadmin' },
    { username: 'gunny', role: 'admin' }
];

async function main() {
    await initSchema();
    await initDashboardUsers();

    for (const { username, role } of ASSIGNMENTS) {
        if (!userExists(username)) {
            console.log(`⚠️  User "${username}" existiert nicht — übersprungen.`);
            continue;
        }
        setUserRole(username, role);
        console.log(`✓ "${username}" -> ${role}`);
    }

    console.log('\nFertig. Bitte einmal neu einloggen, damit die Rolle in der Session aktiv wird.');
}

main().catch(err => {
    console.error('Fehler:', err.message);
    process.exit(1);
});