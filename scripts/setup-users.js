/**
 * Loot-Game Bot — User Setup Script
 * Legt die Dashboard-Benutzer an.
 *
 * Aufruf: node scripts/setup-users.js
 */

require('dotenv').config();
const readline = require('readline');
const { initSchema, initDashboardUsers } = require('../src/db/schema');
const { createUser, userExists } = require('../src/db/users');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║   Loot-Game Bot — User Setup         ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');

    await initSchema();
    await initDashboardUsers();

    const users = [
        { label: 'Superadmin (du)', defaultName: 'coregenetic', role: 'superadmin' },
        { label: 'Gunny (Admin)',   defaultName: 'gunny',        role: 'admin' }
    ];

    for (const u of users) {
        console.log(`\n--- ${u.label} — Rolle: ${u.role} ---`);
        const username = (await ask(`  Username [${u.defaultName}]: `)).trim() || u.defaultName;

        if (userExists(username)) {
            const overwrite = await ask(`  Benutzer "${username}" existiert bereits. Überschreiben? (j/n): `);
            if (overwrite.toLowerCase() !== 'j') {
                console.log(`  Übersprungen.`);
                continue;
            }
        }

        let password = '';
        while (password.length < 10) {
            password = (await ask(`  Passwort (min. 10 Zeichen): `)).trim();
            if (password.length < 10) console.log('  Zu kurz, bitte nochmal.');
        }

        await createUser(username, password, u.role);
        console.log(`  ✓ Benutzer "${username}" angelegt (Rolle: ${u.role}).`);
    }

    console.log('\n✓ Setup abgeschlossen. Starte den Bot mit: npm start\n');
    rl.close();
}

main().catch(err => {
    console.error('Fehler:', err.message);
    rl.close();
    process.exit(1);
});
