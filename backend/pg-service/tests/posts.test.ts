import { beforeEach, afterEach, describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from './appSetup.js';
import prisma from '../src/db.js';

const app = createApp();

const okFetch = (async () => ({
  ok: true,
  json: async () => ({ success: true, message: 'Mocked' })
} as Response)) as unknown as typeof fetch;

const failFetch = (async () => ({
  ok: false,
  json: async () => ({ error: 'Mongo failed' })
} as Response)) as unknown as typeof fetch;

describe('Post Routes Tests', () => {
  beforeEach(() => {
    global.fetch = okFetch as unknown as typeof fetch;
    jest.spyOn(prisma.follow, 'findMany').mockResolvedValue([] as any);
    jest.spyOn(prisma.post, 'create').mockResolvedValue({
      id: 1, authorId: 1, bodyPreview: 'test', createdAt: new Date()
    } as any);
    jest.spyOn(prisma.post, 'findMany').mockResolvedValue([] as any);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  // ============== POST /api/posts — walidacja ==============
  describe('POST /api/posts — walidacja', () => {
    it('zwraca 400 gdy brak authorId', async () => {
      const res = await request(app).post('/api/posts').send({ bodyPreview: 'cos' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('zwraca 400 gdy authorId nie jest liczbą', async () => {
      const res = await request(app).post('/api/posts').send({ authorId: 'abc', bodyPreview: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('zwraca 400 gdy bodyPreview jest pusty', async () => {
      const res = await request(app).post('/api/posts').send({ authorId: 1, bodyPreview: '' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('zwraca 400 gdy bodyPreview to same białe znaki', async () => {
      const res = await request(app).post('/api/posts').send({ authorId: 1, bodyPreview: '     ' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('zwraca 400 gdy bodyPreview > 255 znaków', async () => {
      const res = await request(app).post('/api/posts').send({ authorId: 1, bodyPreview: 'a'.repeat(256) });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('zwraca 400 gdy attachments nie jest tablicą', async () => {
      const res = await request(app)
        .post('/api/posts')
        .send({ authorId: 1, bodyPreview: 'x', attachments: 'string-not-array' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });
  });

  // ============== POST /api/posts — sukces / kompensacja ==============
  describe('POST /api/posts — sukces i kompensacja', () => {
    it('tworzy post i zwraca 201', async () => {
      const res = await request(app).post('/api/posts').send({ authorId: 1, bodyPreview: 'hello' });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe(1);
    });

    it('akceptuje attachments + poll (rich content)', async () => {
      const res = await request(app).post('/api/posts').send({
        authorId: 1,
        bodyPreview: 'rich',
        attachments: [{ url: 'http://x', type: 'image' }],
        poll: { question: 'Q?', options: ['a', 'b'] }
      });
      expect(res.status).toBe(201);
    });

    it('w razie błędu mongo wykonuje kompensację (usuwa post w PG)', async () => {
      global.fetch = failFetch as unknown as typeof fetch;
      const deleteSpy = jest.spyOn(prisma.post, 'delete').mockResolvedValue({ id: 1 } as any);
      const res = await request(app).post('/api/posts').send({ authorId: 1, bodyPreview: 'hello' });
      expect(res.status).toBe(500);
      expect(deleteSpy).toHaveBeenCalledWith({ where: { id: 1 } });
    });
  });

  // ============== GET /api/posts — filtrowanie ==============
  describe('GET /api/posts — listowanie i filtrowanie', () => {
    it('zwraca pustą listę bez filtra', async () => {
      const res = await request(app).get('/api/posts');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('filtruje po authorId (raw SQL)', async () => {
      const rawSpy = jest.spyOn(prisma, '$queryRaw').mockResolvedValue([{ id: 5 }] as any);
      const res = await request(app).get('/api/posts?authorId=1');
      expect(res.status).toBe(200);
      expect(rawSpy).toHaveBeenCalled();
    });

    it('filtruje po hashtag (raw SQL z ILIKE)', async () => {
      const rawSpy = jest.spyOn(prisma, '$queryRaw').mockResolvedValue([] as any);
      const res = await request(app).get('/api/posts?hashtag=tech');
      expect(res.status).toBe(200);
      expect(rawSpy).toHaveBeenCalled();
    });

    it('filtruje po authorId + hashtag jednocześnie', async () => {
      const rawSpy = jest.spyOn(prisma, '$queryRaw').mockResolvedValue([{ id: 9 }] as any);
      const res = await request(app).get('/api/posts?authorId=1&hashtag=tech');
      expect(res.status).toBe(200);
      expect(rawSpy).toHaveBeenCalled();
    });
  });

  // ============== POST /api/posts/:id/reactions — idempotentne ==============
  describe('POST /api/posts/:id/reactions', () => {
    it('zwraca 400 dla niepoprawnego postId (nie-numerycznego)', async () => {
      const res = await request(app).post('/api/posts/abc/reactions').send({ userId: 1, type: 'like' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_POST_ID');
    });

    it('zapisuje reakcję przez upsert i zwraca 200', async () => {
      jest.spyOn(prisma.reaction, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prisma.reaction, 'upsert').mockResolvedValue({
        id: 1, postId: 5, userId: 2, type: 'like', createdAt: new Date()
      } as any);
      const res = await request(app).post('/api/posts/5/reactions').send({ userId: 2, type: 'like' });
      expect(res.status).toBe(200);
      expect(res.body.type).toBe('like');
    });

    it('drugie wywołanie aktualizuje typ reakcji (idempotentność)', async () => {
      jest.spyOn(prisma.reaction, 'findUnique')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ type: 'like' } as any);
      const upsertSpy = jest.spyOn(prisma.reaction, 'upsert')
        .mockResolvedValueOnce({ id: 1, postId: 5, userId: 2, type: 'like', createdAt: new Date() } as any)
        .mockResolvedValueOnce({ id: 1, postId: 5, userId: 2, type: 'love', createdAt: new Date() } as any);
      await request(app).post('/api/posts/5/reactions').send({ userId: 2, type: 'like' });
      const res2 = await request(app).post('/api/posts/5/reactions').send({ userId: 2, type: 'love' });
      expect(res2.body.type).toBe('love');
      expect(upsertSpy).toHaveBeenCalledTimes(2);
    });

    it('powiadamia mongo (fire-and-forget) o nowej reakcji', async () => {
      jest.spyOn(prisma.reaction, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prisma.reaction, 'upsert').mockResolvedValue({
        id: 1, postId: 5, userId: 2, type: 'like', createdAt: new Date()
      } as any);
      const fetchSpy = jest.fn(async () => ({
        ok: true, json: async () => ({ success: true })
      } as Response)) as unknown as typeof fetch;
      global.fetch = fetchSpy;

      const res = await request(app).post('/api/posts/5/reactions').send({ userId: 2, type: 'like' });
      expect(res.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/internal/reactions'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('nie wysyla notyfikacji do mongo gdy typ reakcji sie nie zmienil', async () => {
      jest.spyOn(prisma.reaction, 'findUnique').mockResolvedValue({ type: 'like' } as any);
      jest.spyOn(prisma.reaction, 'upsert').mockResolvedValue({
        id: 1, postId: 5, userId: 2, type: 'like', createdAt: new Date()
      } as any);
      const fetchSpy = jest.fn(async () => ({
        ok: true, json: async () => ({ success: true })
      } as Response)) as unknown as typeof fetch;
      global.fetch = fetchSpy;

      const res = await request(app).post('/api/posts/5/reactions').send({ userId: 2, type: 'like' });
      expect(res.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ============== DELETE /api/posts/:id ==============
  describe('DELETE /api/posts/:id', () => {
    it('zwraca 400 dla niepoprawnego postId', async () => {
      const res = await request(app).delete('/api/posts/abc').send({ requesterId: 1 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_POST_ID');
    });

    it('zwraca 400 gdy brak requesterId', async () => {
      const res = await request(app).delete('/api/posts/5').send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_REQUESTER_ID');
    });

    it('zwraca 400 gdy requesterId nie jest liczbą', async () => {
      const res = await request(app).delete('/api/posts/5').send({ requesterId: 'abc' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_REQUESTER_ID');
    });

    it('zwraca 404 gdy post nie istnieje', async () => {
      jest.spyOn(prisma.post, 'findUnique').mockResolvedValue(null);
      const res = await request(app).delete('/api/posts/9999').send({ requesterId: 1 });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('POST_NOT_FOUND');
    });

    it('zwraca 403 gdy requester nie jest autorem', async () => {
      jest.spyOn(prisma.post, 'findUnique').mockResolvedValue({ id: 5, authorId: 99 } as any);
      const res = await request(app).delete('/api/posts/5').send({ requesterId: 1 });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('NOT_POST_OWNER');
    });

    it('zwraca 204 i wykonuje transakcję kaskadową dla właściciela', async () => {
      jest.spyOn(prisma.post, 'findUnique').mockResolvedValue({ id: 5, authorId: 1 } as any);
      const txSpy = jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: any) => {
        await cb({
          comment: { deleteMany: async () => ({}) },
          reaction: { deleteMany: async () => ({}) },
          post: { delete: async () => ({}) }
        });
      }) as any);
      const res = await request(app).delete('/api/posts/5').send({ requesterId: 1 });
      expect(res.status).toBe(204);
      expect(txSpy).toHaveBeenCalled();
    });
  });
});
