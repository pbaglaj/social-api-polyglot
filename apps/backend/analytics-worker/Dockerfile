FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
# Worker nie ma zaleznosci npm (uzywa wbudowanego fetch z Node 20).
COPY . .
CMD ["node", "src/worker.js"]
