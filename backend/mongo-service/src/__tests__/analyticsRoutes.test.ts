import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import analyticsRoutes from '../analyticsRoutes.js';
import { UserFeedEntry } from '../models/UserFeedEntry.js';

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', analyticsRoutes);
  return app;
};

test('GET /api/analytics/trending returns trending list', async (t) => {
  const mockTrending = [{ postId: 10, reach: 2, averageScore: 1.5 }];
  t.mock.method(UserFeedEntry, 'aggregate', async () => mockTrending);

  const app = createApp();
  const res = await request(app).get('/api/analytics/trending');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.trending, mockTrending);
});
