#!/bin/sh
# Berechtigungen als root fixieren
chown -R node:node /app/data 2>/dev/null || true
find /app/data -name "*.db" -exec chmod 664 {} \; 2>/dev/null || true
# Falls DB root-owned ist, löschen und neu erstellen lassen
if [ -f /app/data/lootgame.db ]; then
    OWNER=$(stat -c '%U' /app/data/lootgame.db 2>/dev/null || echo "unknown")
    if [ "$OWNER" = "root" ]; then
        rm -f /app/data/lootgame.db
    fi
fi

exec su-exec node node src/index.js