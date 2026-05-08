import { beforeAll, afterAll, describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from './appSetup.js';
import prisma from '../src/db.js';

const app = createApp();

global.fetch = jest.fn(
  async () => ({ ok: true, json: async () => ({ success: true, message: 'Mocked' }) } as Response)
) as unknown as typeof fetch;

describe('Comments Tests (Wymóg T15)', () => {
  beforeAll(() => {
    jest.spyOn(prisma.comment, 'create').mockResolvedValue({
      id: 1, postId: 999, authorId: 1, parentId: null, content: 'Testowy komentarz', createdAt: new Date()
    } as any);

    jest.spyOn(prisma.comment, 'findMany').mockResolvedValue([{
      id: 1, postId: 999, authorId: 1, parentId: null, content: 'Testowy komentarz', createdAt: new Date(), author: { username: 'testuser' }, replies: []
    }] as any);
  });
  afterAll(async () => jest.restoreAllMocks());

  it('Powinien dodać komentarz do posta (wątkowanie nullable)', async () => {
    const res = await request(app)
      .post('/api/posts/999/comments')
      .send({ authorId: 1, content: 'Testowy komentarz' });
    
    expect(res.status).toBe(201);
    expect(res.body.content).toBe('Testowy komentarz');
    expect(res.body.parentId).toBeNull();
  });

  it('Powinien zgłosić błąd walidacji przy pustym komentarzu', async () => {
    const res = await request(app)
      .post('/api/posts/999/comments')
      .send({ authorId: 1, content: '   ' });
    
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('Powinien pobrać komentarze dla danego posta', async () => {
    const res = await request(app).get('/api/posts/999/comments');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].content).toBe('Testowy komentarz');
  });
});
