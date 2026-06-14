#!/bin/sh
# Berechtigungen als root fixieren
chown -R node:node /app/data 2>/dev/null || true
chmod -R 664 /app/data/*.db 2>/dev/null || true

# Als node User starten
exec su-exec node node src/index.js
