import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import analyticsRoutes from '../analyticsRoutes.js';
import { ActivityDaily } from '../models/ActivityDaily.js';

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', analyticsRoutes);
  return app;
};

test('GET /api/analytics/reaction-distribution returns aggregated reactions', async (t) => {
  const mockDistribution = [
    { reactionType: 'like', totalCount: 15 },
    { reactionType: 'heart', totalCount: 5 }
  ];
  t.mock.method(ActivityDaily, 'aggregate', async () => mockDistribution);

  const app = createApp();
  const res = await request(app).get('/api/analytics/reaction-distribution');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.distribution, mockDistribution);
});
