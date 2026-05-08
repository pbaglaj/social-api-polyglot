import { beforeAll, afterAll, describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from './appSetup.js';
import prisma from '../src/db.js';

const app = createApp();

global.fetch = jest.fn(
  async () => ({ ok: true, json: async () => ({ success: true, message: 'Mocked' }) } as Response)
) as unknown as typeof fetch;

describe('Post Routes Tests', () => {
  beforeAll(() => {
    jest.spyOn(prisma.post, 'findMany').mockResolvedValue([]);
    jest.spyOn(prisma.post, 'create').mockResolvedValue({ id: 1, authorId: 1, bodyPreview: 'test', createdAt: new Date() } as any);
  });
  afterAll(async () => jest.restoreAllMocks());

  it('1. Powinien zwrócić błąd walidacji przy zbyt długim podglądzie posta', async () => {
    const longText = 'a'.repeat(256);
    const res = await request(app)
      .post('/api/posts')
      .send({ authorId: 1, bodyPreview: longText });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('2. Powinien zwrócić listę postów ze statusem 200', async () => {
    const res = await request(app).get('/api/posts');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
