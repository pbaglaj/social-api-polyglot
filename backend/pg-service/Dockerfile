# Etap 1: Builder
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Generowanie klienta Prisma (wymagane w pg-service)
RUN npx prisma generate
# Typecheck (tsconfig ma noEmit:true — nic nie emituje, ale waliduje typy)
RUN npm run build

# Etap 2: Production
FROM node:22-alpine AS production
WORKDIR /app
COPY package*.json ./
# Instalacja tylko pakietow produkcyjnych
RUN npm ci --omit=dev
# Nie kopiujemy /app/dist — tsc nic nie emituje, a runtime idzie przez tsx.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/knex ./knex
COPY knexfile.cjs ./
COPY tsconfig.json ./
# Prisma wymaga klienta w srodowisku produkcyjnym
RUN npx prisma generate

CMD ["npx", "tsx", "src/index.ts"]
