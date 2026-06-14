import type { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyOptions } from 'jose';

// Walidacja JWT (Keycloak) - klucze publiczne pobierane z sieci wewnetrznej Docker.
const JWKS_URI = process.env.KEYCLOAK_JWKS_URI;
const ALLOWED_ISSUERS = (process.env.KEYCLOAK_ALLOWED_ISSUERS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const AUDIENCE = process.env.KEYCLOAK_AUDIENCE?.trim() || undefined;
const ENFORCE = process.env.NODE_ENV !== 'test';

interface AuthPayload extends JWTPayload {
  realm_access?: { roles?: string[] };
  preferred_username?: string;
  azp?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
      roles?: string[];
    }
  }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) {
    if (!JWKS_URI) throw new Error('KEYCLOAK_JWKS_URI nie jest skonfigurowane');
    jwks = createRemoteJWKSet(new URL(JWKS_URI));
  }
  return jwks;
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

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
    const options: JWTVerifyOptions = {
      issuer: ALLOWED_ISSUERS.length === 1 ? ALLOWED_ISSUERS[0]! : ALLOWED_ISSUERS,
    };
    if (AUDIENCE) options.audience = AUDIENCE;
    const { payload } = await jwtVerify(token, getJwks(), options);
    req.auth = payload as AuthPayload;
    req.roles = (payload as AuthPayload).realm_access?.roles ?? [];
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized', code: 'INVALID_TOKEN', details: 'Weryfikacja tokenu nie powiodla sie.' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!ENFORCE) return next();
    const have = req.roles ?? [];
    if (roles.some((r) => have.includes(r))) return next();
    return res.status(403).json({ error: 'Forbidden', code: 'INSUFFICIENT_ROLE', details: `Wymagana co najmniej jedna z rol: ${roles.join(', ')}.` });
  };
}
