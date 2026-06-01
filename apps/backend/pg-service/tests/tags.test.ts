import { afterEach, describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from './appSetup.js';

const app = createApp();

describe('Tags Routes (T2 - Knex.js)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/tags - walidacja parametrow', () => {
    it('zwraca 400 dla niepoprawnej daty', async () => {
      const res = await request(app).get('/api/tags?createdBefore=not-a-date');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_DATE');
    });
  });

  describe('POST /api/tags', () => {
    it('zwraca 400 gdy brakuje name', async () => {
      const res = await request(app).post('/api/tags').send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_TAG_NAME');
    });

    it('zwraca 400 gdy name dluzsze niz 64 znaki', async () => {
      const res = await request(app).post('/api/tags').send({ name: 'x'.repeat(65) });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TAG_NAME_TOO_LONG');
    });
  });

  describe('POST /api/tags/attach', () => {
    it('zwraca 400 dla nieliczbowego postId', async () => {
      const res = await request(app).post('/api/tags/attach').send({ postId: 'abc', tagName: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_POST_ID');
    });

    it('zwraca 400 dla pustego tagName', async () => {
      const res = await request(app).post('/api/tags/attach').send({ postId: 1, tagName: '' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_TAG_NAME');
    });
  });

  describe('GET /api/tags/:name/posts', () => {
    it('zwraca 400 dla pustej nazwy taga', async () => {
      // Express domyslnie zwroci 404 dla pustego segmentu sciezki - sprawdzam wartosc bialych znakow.
      const res = await request(app).get('/api/tags/%20/posts');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_TAG_NAME');
    });
  });
});
