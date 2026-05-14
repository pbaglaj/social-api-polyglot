import { beforeEach, afterEach, describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from './appSetup.js';
import prisma from '../src/db.js';

const app = createApp();

global.fetch = (async () => ({
  ok: true,
  json: async () => ({ success: true, message: 'Mocked' })
} as Response)) as unknown as typeof fetch;

describe('Comments Tests (Wymóg T15)', () => {
  beforeEach(() => {
    jest.spyOn(prisma.comment, 'findMany').mockResolvedValue([{
      id: 1, postId: 999, authorId: 1, parentId: null, content: 'Testowy komentarz',
      createdAt: new Date(), author: { username: 'testuser' }, replies: []
    }] as any);
  });
  afterEach(() => { jest.restoreAllMocks(); });

  // ============== POST /api/posts/:id/comments ==============
  describe('POST /api/posts/:id/comments', () => {
    it('dodaje komentarz bez parentId (root)', async () => {
      jest.spyOn(prisma.comment, 'create').mockResolvedValue({
        id: 1, postId: 999, authorId: 1, parentId: null, content: 'Testowy komentarz', createdAt: new Date()
      } as any);
      const res = await request(app)
        .post('/api/posts/999/comments')
        .send({ authorId: 1, content: 'Testowy komentarz' });
      expect(res.status).toBe(201);
      expect(res.body.content).toBe('Testowy komentarz');
      expect(res.body.parentId).toBeNull();
    });

    it('dodaje komentarz z parentId (odpowiedź na inny)', async () => {
      jest.spyOn(prisma.comment, 'create').mockResolvedValue({
        id: 2, postId: 999, authorId: 1, parentId: 1, content: 'Odpowiedź', createdAt: new Date()
      } as any);
      const res = await request(app)
        .post('/api/posts/999/comments')
        .send({ authorId: 1, content: 'Odpowiedź', parentId: 1 });
      expect(res.status).toBe(201);
      expect(res.body.parentId).toBe(1);
    });

    it('zwraca 400 dla niepoprawnego postId', async () => {
      const res = await request(app)
        .post('/api/posts/abc/comments')
        .send({ authorId: 1, content: 'X' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_POST_ID');
    });

    it('zwraca 400 przy pustym komentarzu', async () => {
      const res = await request(app)
        .post('/api/posts/999/comments')
        .send({ authorId: 1, content: '   ' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('zwraca 400 gdy brak content', async () => {
      const res = await request(app)
        .post('/api/posts/999/comments')
        .send({ authorId: 1 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('zwraca 400 gdy brak authorId', async () => {
      const res = await request(app)
        .post('/api/posts/999/comments')
        .send({ content: 'X' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('zwraca 400 gdy authorId nie jest liczbą', async () => {
      const res = await request(app)
        .post('/api/posts/999/comments')
        .send({ authorId: 'abc', content: 'X' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });
  });

  // ============== GET /api/posts/:id/comments ==============
  describe('GET /api/posts/:id/comments', () => {
    it('zwraca 400 dla niepoprawnego postId', async () => {
      const res = await request(app).get('/api/posts/abc/comments');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_POST_ID');
    });

    it('zwraca listę komentarzy z eager loaded author', async () => {
      const res = await request(app).get('/api/posts/999/comments');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].content).toBe('Testowy komentarz');
      expect(res.body[0].author.username).toBe('testuser');
    });

    it('zwraca pustą tablicę gdy brak komentarzy', async () => {
      jest.spyOn(prisma.comment, 'findMany').mockResolvedValueOnce([] as any);
      const res = await request(app).get('/api/posts/999/comments');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });
  });
});
