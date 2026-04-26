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
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
# Prisma wymaga klienta w środowisku produkcyjnym
RUN npx prisma generate 

CMD ["node", "dist/index.js"]