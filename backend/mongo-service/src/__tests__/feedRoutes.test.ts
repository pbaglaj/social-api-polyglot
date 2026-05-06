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

test('GET /api/feed/:userId returns feed data', async (t) => {
  const insertedAt = new Date('2026-05-01T10:00:00.000Z');
  const mockFeed = [
    { userId: 7, postId: 101, score: 1, insertedAt },
    { userId: 7, postId: 102, score: 2, insertedAt: new Date('2026-05-01T09:00:00.000Z') }
  ];

  t.mock.method(UserFeedEntry, 'find', () => ({
    sort: () => ({
      limit: () => ({
        populate: () => ({
          lean: async () => mockFeed
        })
      })
    })
  }));

  const app = createApp();
  const res = await request(app).get('/api/feed/7?limit=2');

  assert.equal(res.status, 200);
  assert.equal(Array.isArray(res.body.data), true);
  assert.equal(res.body.data.length, 2);
  assert.equal(res.body.nextCursor, mockFeed[1]?.insertedAt.toISOString());
});
