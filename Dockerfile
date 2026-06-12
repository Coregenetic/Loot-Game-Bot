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

# Node als non-root user
USER node

EXPOSE 3000

CMD ["node", "src/index.js"]
