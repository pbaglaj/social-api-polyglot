import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import internalRoutes from '../internalRoutes.js';
import { RichPost } from '../models/RichPost.js';
import { UserFeedEntry } from '../models/UserFeedEntry.js';
import { ActivityDaily } from '../models/ActivityDaily.js';

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/internal', internalRoutes);
  return app;
};

test('POST /api/internal/rich-posts returns 201', async (t) => {
  t.mock.method(RichPost, 'create', async () => ({ _id: 'x' }));
  t.mock.method(UserFeedEntry, 'insertMany', async () => ([]));
  t.mock.method(ActivityDaily, 'updateOne', async () => ({ acknowledged: true }));

  const app = createApp();
  const res = await request(app)
    .post('/api/internal/rich-posts')
    .send({ postId: 1, authorId: 5, attachments: [], poll: null, followerIds: [10, 11] });

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
});

test('DELETE /api/internal/rich-posts/:postId returns 204', async (t) => {
  t.mock.method(RichPost, 'deleteOne', async () => ({ deletedCount: 1 }));
  t.mock.method(UserFeedEntry, 'deleteMany', async () => ({ deletedCount: 2 }));

  const app = createApp();
  const res = await request(app).delete('/api/internal/rich-posts/123');

  assert.equal(res.status, 204);
});
