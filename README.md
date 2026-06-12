# Loot-Game Bot v2.0

> Tarkov Loot Chat Game — Self-Hosted Bot by Coregenetic

---

## Setup

### 1. Repo klonen
```bash
git clone https://github.com/Coregenetic/loot-game-bot.git
cd loot-game-bot
npm install
```

### 2. .env anlegen
```bash
cp .env.example .env
```
Dann `.env` ausfüllen:
- `TWITCH_BOT_USERNAME` — `LootGameBot`
- `TWITCH_OAUTH_TOKEN` — Token von https://twitchapps.com/tmi/
- `TWITCH_CHANNEL` — dein Twitch-Channel-Name

### 3. Migration (einmalig)
Alte JSON-Profile in `data/legacy_profiles/` legen,
`items.json` nach `data/legacy_items/`,
`game_config.json` nach `data/legacy_config/`.

```bash
npm run import
```

### 4. Bot starten
```bash
npm start
```

---

## Struktur

```
src/
├── index.js          ← Entry Point
├── bot.js            ← tmi.js Bot + Command Router
├── commands/         ← Ein File pro Command
├── db/
│   ├── schema.js     ← SQLite Schema
│   ├── players.js    ← Spieler-Operationen
│   ├── items.js      ← Items-Operationen
│   ├── config.js     ← Config-Operationen
│   └── import_profiles.js ← Migrations-Script
├── api/              ← REST API (Phase 3)
└── utils/
    └── format.js     ← Formatierungs-Hilfsfunktionen
```

---

*by Coregenetic*
