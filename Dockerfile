# ── Build-Stage: Compiler nur hier (fuer native Module wie better-sqlite3) ──
FROM node:22-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Laufzeit-Image: ohne Build-Werkzeuge ──
FROM node:22-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
COPY src/      ./src/
COPY public/   ./public/
COPY scripts/  ./scripts/
RUN mkdir -p /app/data && chown -R node:node /app/data
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/docker-entrypoint.sh"]
