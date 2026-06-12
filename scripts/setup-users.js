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
        { label: 'Admin (du)', defaultName: 'coregenetic' },
        { label: 'Gunny',      defaultName: 'gunny' }
    ];

    for (const u of users) {
        console.log(`\n--- ${u.label} ---`);
        const username = (await ask(`  Username [${u.defaultName}]: `)).trim() || u.defaultName;

        if (userExists(username)) {
            const overwrite = await ask(`  Benutzer "${username}" existiert bereits. Überschreiben? (j/n): `);
            if (overwrite.toLowerCase() !== 'j') {
                console.log(`  Übersprungen.`);
                continue;
            }
        }

        let password = '';
        while (password.length < 6) {
            password = (await ask(`  Passwort (min. 6 Zeichen): `)).trim();
            if (password.length < 6) console.log('  Zu kurz, bitte nochmal.');
        }

        await createUser(username, password);
        console.log(`  ✓ Benutzer "${username}" angelegt.`);
    }

    console.log('\n✓ Setup abgeschlossen. Starte den Bot mit: npm start\n');
    rl.close();
}

main().catch(err => {
    console.error('Fehler:', err.message);
    rl.close();
    process.exit(1);
});
