# Etap 1: Builder
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Generowanie klienta Prisma (wymagane w pg-service)
RUN npx prisma generate
# Kompilacja TypeScript do JS
RUN npm run build

# Etap 2: Production
FROM node:18-alpine AS production
WORKDIR /app
COPY package*.json ./
# Instalacja tylko pakietów produkcyjnych
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/knex ./knex
COPY knexfile.cjs ./
COPY tsconfig.json ./
# Prisma wymaga klienta w środowisku produkcyjnym
RUN npx prisma generate

CMD ["npx", "tsx", "src/index.ts"]
