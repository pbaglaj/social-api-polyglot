// Konfiguracja klienta SPA. Wartosci moga byc nadpisane przez zmienne srodowiskowe
// Vite (wstrzykiwane przy buildzie obrazu). Domyslne wartosci dzialaja z przegladarki
// na hoscie: gateway na :8080, Keycloak na :8090.
export const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? 'http://localhost:8080/api';

export const KC_AUTHORITY: string =
  import.meta.env.VITE_KEYCLOAK_AUTHORITY ??
  'http://localhost:8090/realms/SocialPolyglot';

export const KC_CLIENT_ID: string =
  import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? 'spa-client';
