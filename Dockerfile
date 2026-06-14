FROM node:20-alpine

WORKDIR /app

# Dependencies zuerst (besseres Layer-Caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Source Code
COPY src/      ./src/
COPY public/   ./public/
COPY scripts/  ./scripts/

# Data-Ordner anlegen (wird per Volume gemountet)
RUN mkdir -p /app/data/legacy_profiles \
             /app/data/legacy_items \
             /app/data/legacy_config

# Startup Script das Berechtigungen fixiert
RUN echo '#!/bin/sh' > /app/start.sh && \
    echo 'chmod -f 664 /app/data/*.db 2>/dev/null || true' >> /app/start.sh && \
    echo 'exec node src/index.js' >> /app/start.sh && \
    chmod +x /app/start.sh

USER node

EXPOSE 3000

CMD ["/app/start.sh"]