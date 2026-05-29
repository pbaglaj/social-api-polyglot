# Etap 1: Builder
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Etap 2: Production
FROM node:22-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

# Non-root user (builtin in node:alpine)
RUN chown -R node:node /app
USER node

CMD ["node", "dist/index.js"]
