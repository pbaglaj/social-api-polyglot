import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import feedRoutes from '../feedRoutes.js';
import { UserFeedEntry } from '../models/UserFeedEntry.js';

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/feed', feedRoutes);
  return app;
};

test('GET /api/feed/:userId returns feed data with nextCursor', async (t) => {
  const insertedAt = new Date('2026-05-01T10:00:00.000Z');
  const mockFeed = [
    { userId: 7, postId: 101, score: 1, insertedAt },
    { userId: 7, postId: 102, score: 2, insertedAt: new Date('2026-05-01T09:00:00.000Z') }
  ];

  t.mock.method(UserFeedEntry, 'find', () => ({
    sort: () => ({
      limit: () => ({
        populate: () => ({ lean: async () => mockFeed })
      })
    })
  }));

  const res = await request(createApp()).get('/api/feed/7?limit=2');

  assert.equal(res.status, 200);
  assert.equal(Array.isArray(res.body.data), true);
  assert.equal(res.body.data.length, 2);
  assert.equal(res.body.nextCursor, mockFeed[1]?.insertedAt.toISOString());
});

test('GET /api/feed/:userId returns empty array with null nextCursor', async (t) => {
  t.mock.method(UserFeedEntry, 'find', () => ({
    sort: () => ({
      limit: () => ({
        populate: () => ({ lean: async () => [] })
      })
    })
  }));

  const res = await request(createApp()).get('/api/feed/7');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, []);
  assert.equal(res.body.nextCursor, null);
});

test('GET /api/feed/:userId returns 400 for non-numeric userId', async () => {
  const res = await request(createApp()).get('/api/feed/abc');
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_USER_ID');
});

test('GET /api/feed/:userId returns 400 for invalid cursor', async () => {
  const res = await request(createApp()).get('/api/feed/7?cursor=not-a-date');
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_CURSOR');
});

test('GET /api/feed/:userId applies cursor when valid (paginacja)', async (t) => {
  const calls: any[] = [];
  t.mock.method(UserFeedEntry, 'find', (q: any) => {
    calls.push(q);
    return {
      sort: () => ({
        limit: () => ({
          populate: () => ({ lean: async () => [] })
        })
      })
    };
  });

  const res = await request(createApp()).get('/api/feed/7?cursor=2026-05-01T10:00:00.000Z');
  assert.equal(res.status, 200);
  assert.ok(calls[0].insertedAt, 'query powinno zawierac filtr po insertedAt');
  assert.ok(calls[0].insertedAt.$lt instanceof Date);
});

test('GET /api/feed/:userId returns 500 when DB throws', async (t) => {
  t.mock.method(UserFeedEntry, 'find', () => ({
    sort: () => ({
      limit: () => ({
        populate: () => ({ lean: async () => { throw new Error('mongo down'); } })
      })
    })
  }));

  const res = await request(createApp()).get('/api/feed/7');
  assert.equal(res.status, 500);
  assert.equal(res.body.code, 'FEED_QUERY_FAILED');
});
