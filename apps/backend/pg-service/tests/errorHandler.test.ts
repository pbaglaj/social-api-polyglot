import { beforeAll, afterAll, describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from './appSetup.js';
import prisma from '../src/config/prisma.js';

const app = createApp();

global.fetch = jest.fn(
  async () => ({ ok: true, json: async () => ({ success: true, message: 'Mocked' }) } as Response)
) as unknown as typeof fetch;

describe('zmapowane blędy bazy przez ErrorHandler', () => {
  it('Powinien mapować kod 23505 (unique_violation) na HTTP 409 Conflict', async () => {
    jest.spyOn(prisma.post, 'findMany').mockRejectedValue({ code: '23505' });
    const res = await request(app).get('/api/posts');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('23505');
  });

  it('Powinien mapować kod 23503 na HTTP 400 Bad Request', async () => {
    jest.spyOn(prisma.post, 'findMany').mockRejectedValue({ code: '23503' });
    const res = await request(app).get('/api/posts');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('23503');
  });

  it('Powinien mapować kod 23502 na HTTP 400 Bad Request', async () => {
    jest.spyOn(prisma.post, 'findMany').mockRejectedValue({ code: '23502' });
    const res = await request(app).get('/api/posts');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('23502');
  });

  it('Powinien mapować kod 08006 na HTTP 503', async () => {
    jest.spyOn(prisma.post, 'findMany').mockRejectedValue({ code: '08006' });
    const res = await request(app).get('/api/posts');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('08006');
  });
});
