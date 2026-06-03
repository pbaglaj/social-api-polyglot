# Multi-stage: build SPA (Vite) -> serwuj statyki przez nginx.
FROM node:20-alpine AS build
WORKDIR /app

# VITE_* sa wstrzykiwane przy buildzie (statyczny bundle). Domyslne wartosci celuja
# w hosta (gateway :8080, Keycloak :8090) - dzialaja dla przegladarki uzytkownika.
ARG VITE_API_BASE=http://localhost:8080/api
ARG VITE_KEYCLOAK_AUTHORITY=http://localhost:8090/realms/SocialPolyglot
ARG VITE_KEYCLOAK_CLIENT_ID=spa-client
ENV VITE_API_BASE=$VITE_API_BASE \
    VITE_KEYCLOAK_AUTHORITY=$VITE_KEYCLOAK_AUTHORITY \
    VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID

COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
