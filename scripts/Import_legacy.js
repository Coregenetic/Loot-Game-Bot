/**
 * Legacy Profile Import Script
 * Liest alle JSON-Profile aus data/legacy_profiles/ und importiert sie via API
 * 
 * Usage: node scripts/import_legacy.js
 */

const fs   = require('fs');
const path = require('path');

// ─── Konfiguration ────────────────────────────────────────────────────────────
const BOT_URL  = process.env.BOT_URL  || 'https://lootgamebot.fly.dev';
const TOKEN    = process.env.TOKEN;
const DRY_RUN  = process.argv.includes('--dry-run');
const PROFILES = path.join(__dirname, '../data/legacy_profiles');

if (!TOKEN) {
    console.error('❌ TOKEN fehlt! Nutze: TOKEN=dein-session-token node scripts/import_legacy.js');
    console.error('   Den Token findest du im Browser: localStorage.getItem("lootgame_session_token")');
    process.exit(1);
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────
async function apiCall(endpoint, method = 'GET', body = null) {
    const res = await fetch(`${BOT_URL}${endpoint}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'x-session-token': TOKEN
        },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
}

// ─── Hauptlogik ───────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n🎮 Loot-Game Legacy Import`);
    console.log(`📡 Bot URL: ${BOT_URL}`);
    console.log(`${DRY_RUN ? '🔍 DRY RUN — keine Daten werden gespeichert' : '✅ LIVE MODE'}\n`);

    // Auth prüfen
    try {
        const me = await apiCall('/api/auth/me');
        console.log(`🔑 Eingeloggt als: ${me.username}\n`);
    } catch (err) {
        console.error('❌ Auth fehlgeschlagen:', err.message);
        process.exit(1);
    }

    // Profile laden
    const files = fs.readdirSync(PROFILES).filter(f => f.endsWith('.json'));
    console.log(`📂 ${files.length} Profile gefunden\n`);

    let imported = 0, skipped = 0, errors = 0;

    for (const file of files) {
        const username = path.basename(file, '.json');
        const raw      = fs.readFileSync(path.join(PROFILES, file), 'utf-8');
        
        let profile;
        try {
            profile = JSON.parse(raw);
        } catch {
            console.error(`  ❌ ${username}: Ungültiges JSON`);
            errors++;
            continue;
        }

        // Leere/minimale Profile überspringen
        if (!profile.Level && !profile.XP && !profile.RaidsTotal) {
            console.log(`  ⏭ ${username}: leer, übersprungen`);
            skipped++;
            continue;
        }

        if (DRY_RUN) {
            console.log(`  🔍 ${username}: Lvl ${profile.Level||1}, ${profile.RaidsTotal||0} Raids, ${Object.keys(profile.Inventory||{}).length} Items`);
            imported++;
            continue;
        }

        try {
            // 1. Spieler-Stats setzen (PATCH erstellt automatisch wenn nicht vorhanden)
            await apiCall(`/api/players/${username}`, 'PATCH', {
                level:          profile.Level         || 1,
                xp:             profile.XP            || 0,
                prestige:       profile.Prestige       || 0,
                has_kappa:      profile.HasKappa       ? 1 : 0,
                raids_total:    profile.RaidsTotal     || 0,
                raids_survived: profile.RaidsSurvived  || 0,
                raids_died:     profile.RaidsDied      || 0
            });

            // 2. Inventar importieren (falls vorhanden)
            if (profile.Inventory && Object.keys(profile.Inventory).length > 0) {
                await apiCall(`/api/players/${username}/inventory`, 'PUT', profile.Inventory);
            }

            console.log(`  ✅ ${username}: Lvl ${profile.Level||1}, ${profile.RaidsTotal||0} Raids, ${Object.keys(profile.Inventory||{}).length} Items`);
            imported++;
        } catch (err) {
            console.error(`  ❌ ${username}: ${err.message}`);
            errors++;
        }

        // Kurze Pause um den Server nicht zu überlasten
        await new Promise(r => setTimeout(r, 50));
    }

    console.log(`\n─────────────────────────────────`);
    console.log(`✅ Importiert: ${imported}`);
    console.log(`⏭ Übersprungen: ${skipped}`);
    console.log(`❌ Fehler: ${errors}`);
    console.log(`─────────────────────────────────\n`);
}

main().catch(err => {
    console.error('Fataler Fehler:', err);
    process.exit(1);
});