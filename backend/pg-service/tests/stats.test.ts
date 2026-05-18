import { beforeEach, afterEach, describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from './appSetup.js';
import pgPool from '../src/pgPool.js';

const app = createApp();

describe('Stats Routes (T1 - sterownik pg)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/stats/user/:id', () => {
    it('zwraca 400 dla niepoprawnego ID (nie-numerycznego)', async () => {
      const res = await request(app).get('/api/stats/user/abc');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_USER_ID');
    });

    it('zwraca 404 gdy uzytkownik nie istnieje', async () => {
      jest.spyOn(pgPool, 'query').mockResolvedValueOnce({
        rowCount: 0, rows: [], command: 'SELECT', oid: 0, fields: []
      } as any);
      const res = await request(app).get('/api/stats/user/9999');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('USER_NOT_FOUND');
    });

    it('zwraca uzytkownika ze statystykami przy uzyciu parametryzowanego zapytania', async () => {
      const querySpy = jest.spyOn(pgPool, 'query')
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 1, username: 'alice', email: 'a@x.pl', created_at: new Date() }],
          command: 'SELECT', oid: 0, fields: []
        } as any)
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ posts_count: '3', followers_count: '5', following_count: '7', reactions_received: '11' }],
          command: 'SELECT', oid: 0, fields: []
        } as any);

      const res = await request(app).get('/api/stats/user/1');
      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe('alice');
      expect(res.body.stats).toEqual({
        postsCount: 3, followersCount: 5, followingCount: 7, reactionsReceived: 11
      });

      // Walidacja: ZAWSZE wywolywane z parametrami w drugim argumencie (T1).
      const firstCall = querySpy.mock.calls[0] as any[];
      expect(firstCall[0]).toContain('$1');
      expect(firstCall[1]).toEqual([1]);
    });
  });

  describe('GET /api/stats/posts/top', () => {
    it('zwraca 400 dla niepoprawnego parametru since', async () => {
      const res = await request(app).get('/api/stats/posts/top?since=not-a-date');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_SINCE');
    });

    it('zwraca top posty z parametryzacja $1 $2', async () => {
      const querySpy = jest.spyOn(pgPool, 'query').mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 5, body_preview: 'p', author_id: 1, created_at: new Date(), reactions_count: '4' }],
        command: 'SELECT', oid: 0, fields: []
      } as any);

      const res = await request(app).get('/api/stats/posts/top?limit=5');
      expect(res.status).toBe(200);
      expect(res.body.posts).toHaveLength(1);
      expect(res.body.posts[0].reactionsCount).toBe(4);

      // T1: wywolanie ma $1, $2 i tablice parametrow.
      const call = querySpy.mock.calls[0] as any[];
      expect(call[0]).toContain('$1');
      expect(call[0]).toContain('$2');
      expect(Array.isArray(call[1])).toBe(true);
      expect((call[1] as any[]).length).toBe(2);
    });

    it('mapuje natywny kod PG (np. 22P02) na HTTP 400', async () => {
      const pgError: any = new Error('invalid input syntax');
      pgError.code = '22P02';
      jest.spyOn(pgPool, 'query').mockRejectedValueOnce(pgError);

      const res = await request(app).get('/api/stats/posts/top');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('22P02');
    });
  });
});
