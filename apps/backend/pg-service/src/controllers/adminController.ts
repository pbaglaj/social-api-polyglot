import type { Request, Response, NextFunction } from 'express';
import * as kc from '../services/keycloakAdmin.js';

// Endpointy administracyjne - dostepne tylko dla roli Admin (RBAC w routerze).
// Realizuja wymóg "zarzadzania uzytkownikami przez dedykowane API" - backend
// deleguje operacje do Keycloak Admin REST API (Authorization Server).

const VALID_ROLES = ['Admin', 'User', 'Moderator'];

export async function listKcUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const users = await kc.listUsers(search);
    res.json({ users });
  } catch (err) {
    next(err);
  }
}

export async function createKcUser(req: Request, res: Response, next: NextFunction) {
  const { username, email, password, firstName, lastName, roles } = req.body || {};
  if (typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_USERNAME', details: 'username wymagany.' });
  }
  if (typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_EMAIL', details: 'Poprawny email wymagany.' });
  }
  if (typeof password !== 'string' || password.length < 4) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_PASSWORD', details: 'Haslo min. 4 znaki.' });
  }
  const requestedRoles: string[] = Array.isArray(roles) ? roles.filter((r: string) => VALID_ROLES.includes(r)) : ['User'];

  try {
    const result = await kc.createUser({
      username: username.trim(),
      email: email.trim(),
      firstName,
      lastName,
      password,
      temporary: Boolean(req.body?.temporary),
      roles: requestedRoles.length ? requestedRoles : ['User'],
    });
    res.status(201).json({ success: true, id: result.id, roles: requestedRoles });
  } catch (err) {
    next(err);
  }
}

export async function assignRoles(req: Request, res: Response, next: NextFunction) {
  const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const roles: string[] = Array.isArray(req.body?.roles) ? req.body.roles.filter((r: string) => VALID_ROLES.includes(r)) : [];
  if (!userId || !roles.length) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_ROLES', details: `Podaj userId i przynajmniej jedna z rol: ${VALID_ROLES.join(', ')}.` });
  }
  try {
    await kc.assignRealmRoles(userId, roles);
    res.json({ success: true, userId, assigned: roles });
  } catch (err) {
    next(err);
  }
}

export async function revokeRoles(req: Request, res: Response, next: NextFunction) {
  const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const roles: string[] = Array.isArray(req.body?.roles) ? req.body.roles.filter((r: string) => VALID_ROLES.includes(r)) : [];
  if (!userId || !roles.length) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_ROLES', details: 'Podaj userId i role do odebrania.' });
  }
  try {
    await kc.removeRealmRoles(userId, roles);
    res.json({ success: true, userId, revoked: roles });
  } catch (err) {
    next(err);
  }
}

export async function resetUserPassword(req: Request, res: Response, next: NextFunction) {
  const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { password, temporary } = req.body || {};
  if (!userId || typeof password !== 'string' || password.length < 4) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_PASSWORD', details: 'Podaj userId i haslo min. 4 znaki.' });
  }
  try {
    await kc.resetPassword(userId, password, temporary ?? true);
    res.json({ success: true, userId });
  } catch (err) {
    next(err);
  }
}

// Odzyskiwanie hasla: deleguje do Keycloak. Preferuje maila z linkiem resetu
// (execute-actions-email UPDATE_PASSWORD); gdy realm nie ma SMTP, ustawia wymaganaa
// akcje UPDATE_PASSWORD - user zmieni haslo przy najblizszym logowaniu (bez maila).
export async function recoverPassword(req: Request, res: Response, next: NextFunction) {
  const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!userId) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_USER_ID', details: 'Podaj userId.' });
  }
  try {
    await kc.sendExecuteActionsEmail(userId, ['UPDATE_PASSWORD']);
    return res.json({ success: true, userId, method: 'email', action: 'UPDATE_PASSWORD' });
  } catch {
    // brak SMTP / mail nie wyszedl - fallback na wymaganaa akcje (dziala zawsze)
    try {
      await kc.addRequiredActions(userId, ['UPDATE_PASSWORD']);
      return res.json({ success: true, userId, method: 'required_action', action: 'UPDATE_PASSWORD' });
    } catch (err) {
      return next(err);
    }
  }
}

// Wlaczenie 2FA/MFA (TOTP): wymusza konfiguracje aplikacji authenticatora przy
// najblizszym logowaniu (wymagana akcja CONFIGURE_TOTP) i probuje wyslac maila.
export async function enableMfa(req: Request, res: Response, next: NextFunction) {
  const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!userId) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_USER_ID', details: 'Podaj userId.' });
  }
  try {
    await kc.addRequiredActions(userId, ['CONFIGURE_TOTP']);
    // mail to dodatek - brak SMTP nie moze wywrocic operacji
    let emailed = false;
    try {
      await kc.sendExecuteActionsEmail(userId, ['CONFIGURE_TOTP']);
      emailed = true;
    } catch {
      /* SMTP nieskonfigurowany - akcja i tak wymuszona przy logowaniu */
    }
    res.json({ success: true, userId, action: 'CONFIGURE_TOTP', emailed });
  } catch (err) {
    next(err);
  }
}

// Wylaczenie 2FA/MFA: usuwa skonfigurowane czynniki TOTP i sciaga wymaganaa akcje.
export async function disableMfa(req: Request, res: Response, next: NextFunction) {
  const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!userId) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_USER_ID', details: 'Podaj userId.' });
  }
  try {
    const removed = await kc.deleteOtpCredentials(userId);
    await kc.removeRequiredActions(userId, ['CONFIGURE_TOTP']);
    res.json({ success: true, userId, removedFactors: removed });
  } catch (err) {
    next(err);
  }
}

// Zwraca tozsamosc zalogowanego uzytkownika (z tokenu + lokalny profil).
export function whoami(req: Request, res: Response) {
  res.json({
    authenticated: Boolean(req.auth),
    keycloakId: req.auth?.sub ?? null,
    username: req.auth?.preferred_username ?? null,
    email: req.auth?.email ?? null,
    roles: req.roles ?? [],
    appUser: req.appUser ?? null,
  });
}
