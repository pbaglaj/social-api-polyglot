import { afterEach, describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from './appSetup.js';

const app = createApp();

// Mockujemy warstwe HTTP do Keycloak Admin REST API (global.fetch). Kazda funkcja
// keycloakAdmin.ts wola fetch - routujemy odpowiedzi po URL/metodzie. ENFORCE=false
// w trybie testowym, wiec auth/RBAC sa pass-through (nie potrzeba realnego tokenu).
type FetchMock = (url: string, init?: RequestInit) => Promise<Response>;

const json = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() } as unknown as Response);

const noContent = (): Response =>
  ({ ok: true, status: 204, json: async () => ({}), text: async () => '', headers: new Map() } as unknown as Response);

function installFetch(router: FetchMock) {
  global.fetch = ((input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    // token client-credentials zawsze OK
    if (url.includes('/protocol/openid-connect/token')) {
      return Promise.resolve(json(200, { access_token: 'fake', expires_in: 60 }));
    }
    return router(url, init);
  }) as unknown as typeof fetch;
}

describe('Admin Routes (zarzadzanie userami przez Keycloak Admin API)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /api/admin/users/:id/recover-password', () => {
    it('uzywa maila (execute-actions-email) gdy SMTP dziala', async () => {
      installFetch((url, init) => {
        if (url.includes('/execute-actions-email') && init?.method === 'PUT') return Promise.resolve(noContent());
        return Promise.resolve(json(500, { error: 'unexpected' }));
      });
      const res = await request(app).post('/api/admin/users/abc-123/recover-password');
      expect(res.status).toBe(200);
      expect(res.body.method).toBe('email');
      expect(res.body.action).toBe('UPDATE_PASSWORD');
    });

    it('fallback na wymaganaa akcje gdy mail (SMTP) zawiedzie', async () => {
      installFetch((url, init) => {
        if (url.includes('/execute-actions-email')) return Promise.resolve(json(500, { error: 'no smtp' }));
        if (url.match(/\/users\/abc-123$/) && (!init?.method || init.method === 'GET'))
          return Promise.resolve(json(200, { id: 'abc-123', username: 'u', requiredActions: [] }));
        if (url.match(/\/users\/abc-123$/) && init?.method === 'PUT') return Promise.resolve(noContent());
        return Promise.resolve(json(500, { error: 'unexpected' }));
      });
      const res = await request(app).post('/api/admin/users/abc-123/recover-password');
      expect(res.status).toBe(200);
      expect(res.body.method).toBe('required_action');
    });
  });

  describe('POST /api/admin/users/:id/mfa', () => {
    it('wymusza CONFIGURE_TOTP (merge z istniejacymi akcjami)', async () => {
      const puts: any[] = [];
      installFetch((url, init) => {
        if (url.match(/\/users\/u1$/) && (!init?.method || init.method === 'GET'))
          return Promise.resolve(json(200, { id: 'u1', username: 'u', requiredActions: ['VERIFY_EMAIL'] }));
        if (url.match(/\/users\/u1$/) && init?.method === 'PUT') {
          puts.push(JSON.parse(init.body as string));
          return Promise.resolve(noContent());
        }
        if (url.includes('/execute-actions-email')) return Promise.resolve(noContent());
        return Promise.resolve(json(500, { error: 'unexpected' }));
      });
      const res = await request(app).post('/api/admin/users/u1/mfa');
      expect(res.status).toBe(200);
      expect(res.body.action).toBe('CONFIGURE_TOTP');
      expect(puts[0].requiredActions).toEqual(expect.arrayContaining(['VERIFY_EMAIL', 'CONFIGURE_TOTP']));
    });
  });

  describe('DELETE /api/admin/users/:id/mfa', () => {
    it('usuwa czynniki TOTP i sciaga wymaganaa akcje', async () => {
      installFetch((url, init) => {
        if (url.includes('/credentials/cred-otp') && init?.method === 'DELETE') return Promise.resolve(noContent());
        if (url.endsWith('/credentials'))
          return Promise.resolve(json(200, [
            { id: 'cred-pwd', type: 'password' },
            { id: 'cred-otp', type: 'otp' },
          ]));
        if (url.match(/\/users\/u2$/) && (!init?.method || init.method === 'GET'))
          return Promise.resolve(json(200, { id: 'u2', username: 'u', requiredActions: ['CONFIGURE_TOTP'] }));
        if (url.match(/\/users\/u2$/) && init?.method === 'PUT') return Promise.resolve(noContent());
        return Promise.resolve(json(500, { error: 'unexpected' }));
      });
      const res = await request(app).delete('/api/admin/users/u2/mfa');
      expect(res.status).toBe(200);
      expect(res.body.removedFactors).toBe(1);
    });
  });
});
