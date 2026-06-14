import type { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyOptions } from 'jose';
import prisma from '../config/prisma.js';

// --- Konfiguracja walidacji JWT (Keycloak jako Authorization Server) ---
const JWKS_URI = process.env.KEYCLOAK_JWKS_URI;
const ALLOWED_ISSUERS = (process.env.KEYCLOAK_ALLOWED_ISSUERS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const AUDIENCE = process.env.KEYCLOAK_AUDIENCE?.trim() || undefined;

// W testach jednostkowych nie ma Keycloaka - nie wymuszamy tokenu (kontrolery
// maja fallback na ID z body). W realnym uruchomieniu (docker compose) ENFORCE=true.
const ENFORCE = process.env.NODE_ENV !== 'test';

export interface AuthPayload extends JWTPayload {
  realm_access?: { roles?: string[] };
  preferred_username?: string;
  email?: string;
  name?: string;
}

export interface AppUser {
  id: number;
  keycloakId: string;
  username: string;
  roles: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
      roles?: string[];
      appUser?: AppUser;
    }
  }
}

// JWKS pobierany leniwie z sieci wewnetrznej Docker (keycloak:8080).
// jose cache'uje klucze i odswieza je przy rotacji (kid).
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) {
    if (!JWKS_URI) throw new Error('KEYCLOAK_JWKS_URI nie jest skonfigurowane');
    jwks = createRemoteJWKSet(new URL(JWKS_URI));
  }
  return jwks;
}

async function verifyToken(token: string): Promise<AuthPayload> {
  // Akceptujemy oba wystawienia: z hosta (SPA: localhost:8090) oraz z sieci
  // wewnetrznej (M2M/SSR: keycloak:8080). To ten sam realm i te same klucze.
  const options: JWTVerifyOptions = {
    issuer: ALLOWED_ISSUERS.length === 1 ? ALLOWED_ISSUERS[0]! : ALLOWED_ISSUERS,
  };
  if (AUDIENCE) options.audience = AUDIENCE;
  const { payload } = await jwtVerify(token, getJwks(), options);
  return payload as AuthPayload;
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/**
 * Wymusza poprawny token Bearer podpisany przez Keycloak.
 * Ustawia req.auth (payload) oraz req.roles (realm_access.roles).
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Decyzja o pominieciu walidacji zalezy wylacznie od ENFORCE (NODE_ENV po
  // stronie serwera), nigdy od danych z requestu. Sprawdzamy ja przed odczytem
  // tokenu, zeby dane kontrolowane przez uzytkownika nie sterowaly bypassem.
  if (!ENFORCE) return next();
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', code: 'NO_TOKEN', details: 'Brak naglowka Authorization: Bearer <token>.' });
  }
  try {
    const payload = await verifyToken(token);
    req.auth = payload;
    req.roles = payload.realm_access?.roles ?? [];
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized', code: 'INVALID_TOKEN', details: 'Weryfikacja tokenu nie powiodla sie (podpis/issuer/expiry).' });
  }
}

/** RBAC: przepuszcza tylko jezeli token ma co najmniej jedna z podanych rol realm. */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!ENFORCE) return next();
    const have = req.roles ?? [];
    if (roles.some((r) => have.includes(r))) return next();
    return res.status(403).json({
      error: 'Forbidden',
      code: 'INSUFFICIENT_ROLE',
      details: `Wymagana co najmniej jedna z rol: ${roles.join(', ')}.`,
    });
  };
}

async function createLocalUser(sub: string, username: string, email: string) {
  // Obsluga kolizji unikalnosci (username/email) - suffix z fragmentu sub.
  for (let attempt = 0; attempt < 4; attempt++) {
    const u = attempt === 0 ? username : `${username}-${sub.slice(0, 4)}${attempt}`;
    const em = attempt === 0 ? email : `${sub.slice(0, 4)}${attempt}.${email}`;
    try {
      return await prisma.user.create({ data: { keycloakId: sub, username: u, email: em } });
    } catch {
      // kolizja - probujemy z innym suffixem
    }
  }
  throw new Error('Nie udalo sie sprovisionowac lokalnego usera dla tozsamosci Keycloak');
}

/**
 * JIT provisioning: mapuje tozsamosc z JWT (sub) na lokalny rekord User.
 * Dolinkowuje istniejace (seedowane) konta po username/email przy pierwszym logowaniu.
 * Ustawia req.appUser (z lokalnym int id uzywanym przez relacje w bazie).
 */
export async function provisionUser(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.sub) return next(); // anonim (tryb testowy lub endpoint publiczny)
  const sub = req.auth.sub;
  const username = req.auth.preferred_username || req.auth.email || `kc-${sub.slice(0, 8)}`;
  const email = req.auth.email || `${username}@keycloak.local`;

  try {
    let user = await prisma.user.findFirst({ where: { keycloakId: sub } });
    if (!user) {
      const legacy = await prisma.user.findFirst({ where: { OR: [{ username }, { email }] } });
      if (legacy && !legacy.keycloakId) {
        user = await prisma.user.update({ where: { id: legacy.id }, data: { keycloakId: sub } });
      } else if (!legacy) {
        user = await createLocalUser(sub, username, email);
      } else {
        // legacy ma juz inny keycloakId - tworzymy oddzielne konto
        user = await createLocalUser(sub, username, email);
      }
    }
    req.appUser = { id: user.id, keycloakId: sub, username: user.username, roles: req.roles ?? [] };
    return next();
  } catch (err) {
    return next(err);
  }
}

export const isPrivileged = (req: Request) => {
  const roles = req.roles ?? [];
  return roles.includes('Admin') || roles.includes('Moderator');
};
