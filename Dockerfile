FROM node:20-alpine
RUN apk add --no-cache su-exec python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/      ./src/
COPY public/   ./public/
COPY scripts/  ./scripts/
RUN mkdir -p /app/data && chown -R node:node /app/data
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]