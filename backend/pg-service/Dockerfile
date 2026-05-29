# Etap 1: Builder
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Generowanie klienta Prisma (wymagane do uruchomienia aplikacji)
RUN npx prisma generate

# Etap 2: Production
FROM node:22-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/knex ./knex
COPY knexfile.cjs ./
COPY tsconfig.json ./
RUN npx prisma generate

# Non-root user (builtin in node:alpine)
RUN chown -R node:node /app
USER node

CMD ["npx", "tsx", "src/index.ts"]
