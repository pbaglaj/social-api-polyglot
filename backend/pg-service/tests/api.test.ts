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

describe('PostgreSQL Error Code Mapping Tests', () => {

  it('Powinien mapować kod 23505 (unique_violation) na HTTP 409 Conflict', async () => {
    const testApp = express();
    testApp.use(express.json());
    testApp.get('/test', (req, res, next) => {
      const err = new Error('Duplicate key value violates unique constraint');
      (err as any).code = '23505';
      next(err);
    });
    testApp.use(errorHandler);

    const res = await request(testApp).get('/test');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Conflict');
    expect(res.body.code).toBe('23505');
  });

  it('Powinien mapować kod 23503 (foreign_key_violation) na HTTP 400 Bad Request', async () => {
    const testApp = express();
    testApp.use(express.json());
    testApp.get('/test', (req, res, next) => {
      const err = new Error('Foreign key constraint violation');
      (err as any).code = '23503';
      next(err);
    });
    testApp.use(errorHandler);

    const res = await request(testApp).get('/test');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Bad Request');
    expect(res.body.code).toBe('23503');
  });

  it('Powinien mapować kod 23502 (not_null_violation) na HTTP 400 Bad Request', async () => {
    const testApp = express();
    testApp.use(express.json());
    testApp.get('/test', (req, res, next) => {
      const err = new Error('Null value not allowed');
      (err as any).code = '23502';
      next(err);
    });
    testApp.use(errorHandler);

    const res = await request(testApp).get('/test');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Bad Request');
    expect(res.body.code).toBe('23502');
  });

  it('Powinien mapować kod 08006 (connection_failure) na HTTP 503 Service Unavailable', async () => {
    const testApp = express();
    testApp.use(express.json());
    testApp.get('/test', (req, res, next) => {
      const err = new Error('Connection lost');
      (err as any).code = '08006';
      next(err);
    });
    testApp.use(errorHandler);

    const res = await request(testApp).get('/test');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Service Unavailable');
    expect(res.body.code).toBe('08006');
  });

});