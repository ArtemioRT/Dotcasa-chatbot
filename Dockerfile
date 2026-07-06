# ── dotcasa-chatbot ──────────────────────────────────────────────
FROM node:20-slim AS deps

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ── imagen final ─────────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
