#!/bin/sh
# Berechtigungen als root fixieren, dann als User "node" starten.
# (Frueher wurde eine root-eigene DB hier geloescht — das war ein Datenverlust-Risiko;
#  jetzt wird sie stattdessen einfach dem User "node" zugewiesen.)
chown -R node:node /app/data 2>/dev/null || true
find /app/data -name "*.db*" -exec chmod 660 {} \; 2>/dev/null || true

exec su-exec node node src/index.js
