import { describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import postRoutes from '../src/postRoutes';
import userRoutes from '../src/userRoutes';
import { errorHandler } from '../src/errorHandler';

// Konfiguracja testowej aplikacji Express
const app = express();
app.use(express.json());
app.use('/api/posts', postRoutes);
app.use('/api/users', userRoutes);
app.use(errorHandler);

// Mockowanie globalnego fetch (izolujemy serwis podczas testów)
global.fetch = jest.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
    ({
      ok: true,
      json: async () => ({ success: true, message: 'Mocked RichPost' }),
    } as Response)
) as unknown as typeof fetch;

describe('API Integration Tests (PG Service)', () => {

  it('1. Powinien zwrócić błąd walidacji przy zbyt długim podglądzie posta', async () => {
    const longText = 'a'.repeat(256);
    const res = await request(app)
      .post('/api/posts')
      .send({ authorId: 1, bodyPreview: longText });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('2. Powinien zablokować obserwowanie samego siebie (Wymóg T18 - Self-follow)', async () => {
    // followerId i followeeId (w URL) są takie same
    const res = await request(app)
      .post('/api/users/1/follow')
      .send({ followerId: 1 }); 

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SELF_FOLLOW');
  });

  it('3. Powinien zwrócić listę postów ze statusem 200', async () => {
    const res = await request(app).get('/api/posts');
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

});