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

// ========== POST /api/internal/rich-posts ==========

test('POST /api/internal/rich-posts returns 201 with fan-out', async (t) => {
  const insertManySpy: any[] = [];
  t.mock.method(RichPost, 'create', async () => ({ _id: 'x' }));
  t.mock.method(UserFeedEntry, 'insertMany', async (docs: any) => {
    insertManySpy.push(docs);
    return docs;
  });
  t.mock.method(ActivityDaily, 'updateOne', async () => ({ acknowledged: true }));

  const res = await request(createApp())
    .post('/api/internal/rich-posts')
    .send({ postId: 1, authorId: 5, attachments: [], poll: null, followerIds: [10, 11] });

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(insertManySpy[0].length, 2, 'fan-out powinien wstawić 2 wpisy feedu');
});

test('POST /api/internal/rich-posts works when followerIds is empty (brak fan-out)', async (t) => {
  let insertManyCalled = false;
  t.mock.method(RichPost, 'create', async () => ({ _id: 'x' }));
  t.mock.method(UserFeedEntry, 'insertMany', async () => { insertManyCalled = true; return []; });
  t.mock.method(ActivityDaily, 'updateOne', async () => ({ acknowledged: true }));

  const res = await request(createApp())
    .post('/api/internal/rich-posts')
    .send({ postId: 1, authorId: 5, attachments: [], followerIds: [] });

  assert.equal(res.status, 201);
  assert.equal(insertManyCalled, false, 'pusta lista nie powinna wywoływać insertMany');
});

test('POST /api/internal/rich-posts returns 500 when RichPost.create fails', async (t) => {
  t.mock.method(RichPost, 'create', async () => { throw new Error('mongo down'); });
  t.mock.method(ActivityDaily, 'updateOne', async () => ({ acknowledged: true }));

  const res = await request(createApp())
    .post('/api/internal/rich-posts')
    .send({ postId: 1, authorId: 5, attachments: [], followerIds: [10] });

  assert.equal(res.status, 500);
  assert.equal(res.body.code, 'MONGO_WRITE_FAILED');
});

test('POST /api/internal/rich-posts aktualizuje ActivityDaily (postsCreated++)', async (t) => {
  const updateOneCalls: any[] = [];
  t.mock.method(RichPost, 'create', async () => ({ _id: 'x' }));
  t.mock.method(UserFeedEntry, 'insertMany', async () => []);
  t.mock.method(ActivityDaily, 'updateOne', async (filter: any, update: any, options: any) => {
    updateOneCalls.push({ filter, update, options });
    return { acknowledged: true };
  });

  const res = await request(createApp())
    .post('/api/internal/rich-posts')
    .send({ postId: 42, authorId: 7, attachments: [], followerIds: [] });

  assert.equal(res.status, 201);
  assert.equal(updateOneCalls[0].filter.authorId, 7);
  assert.deepEqual(updateOneCalls[0].update.$inc, { postsCreated: 1 });
  assert.equal(updateOneCalls[0].options.upsert, true);
});

// ========== POST /api/internal/reactions ==========

test('POST /api/internal/reactions inkrementuje nowy typ (brak poprzedniego)', async (t) => {
  const calls: any[] = [];
  t.mock.method(ActivityDaily, 'updateOne', async (filter: any, update: any, options: any) => {
    calls.push({ filter, update, options });
    return { acknowledged: true };
  });

  const res = await request(createApp())
    .post('/api/internal/reactions')
    .send({ userId: 5, type: 'like', previousType: null });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(calls[0].filter.authorId, 5);
  assert.deepEqual(calls[0].update.$inc, { 'reactionsGiven.like': 1 });
  assert.equal(calls[0].options.upsert, true);
});

test('POST /api/internal/reactions dekrementuje stary i inkrementuje nowy (zmiana typu)', async (t) => {
  const calls: any[] = [];
  t.mock.method(ActivityDaily, 'updateOne', async (filter: any, update: any) => {
    calls.push({ filter, update });
    return { acknowledged: true };
  });

  const res = await request(createApp())
    .post('/api/internal/reactions')
    .send({ userId: 5, type: 'love', previousType: 'like' });

  assert.equal(res.status, 200);
  assert.deepEqual(calls[0].update.$inc, {
    'reactionsGiven.love': 1,
    'reactionsGiven.like': -1
  });
});

test('POST /api/internal/reactions ignoruje previousType gdy taki sam jak nowy', async (t) => {
  const calls: any[] = [];
  t.mock.method(ActivityDaily, 'updateOne', async (filter: any, update: any) => {
    calls.push({ filter, update });
    return { acknowledged: true };
  });

  const res = await request(createApp())
    .post('/api/internal/reactions')
    .send({ userId: 5, type: 'like', previousType: 'like' });

  assert.equal(res.status, 200);
  // Tylko jeden klucz w $inc — bez dekrementacji.
  assert.deepEqual(calls[0].update.$inc, { 'reactionsGiven.like': 1 });
});

test('POST /api/internal/reactions zwraca 400 dla brakujacego userId', async () => {
  const res = await request(createApp())
    .post('/api/internal/reactions')
    .send({ type: 'like' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_USER_ID');
});

test('POST /api/internal/reactions zwraca 400 dla pustego type', async () => {
  const res = await request(createApp())
    .post('/api/internal/reactions')
    .send({ userId: 5, type: '   ' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_TYPE');
});

test('POST /api/internal/reactions zwraca 500 gdy DB pada', async (t) => {
  t.mock.method(ActivityDaily, 'updateOne', async () => { throw new Error('mongo down'); });

  const res = await request(createApp())
    .post('/api/internal/reactions')
    .send({ userId: 5, type: 'like' });
  assert.equal(res.status, 500);
  assert.equal(res.body.code, 'REACTION_UPDATE_FAILED');
});

// ========== DELETE /api/internal/rich-posts/:postId ==========

test('DELETE /api/internal/rich-posts/:postId returns 204', async (t) => {
  t.mock.method(RichPost, 'deleteOne', async () => ({ deletedCount: 1 }));
  t.mock.method(UserFeedEntry, 'deleteMany', async () => ({ deletedCount: 2 }));

  const res = await request(createApp()).delete('/api/internal/rich-posts/123');
  assert.equal(res.status, 204);
});

test('DELETE /api/internal/rich-posts/:postId returns 400 for non-numeric id', async () => {
  const res = await request(createApp()).delete('/api/internal/rich-posts/not-a-number');
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_POST_ID');
});

test('DELETE /api/internal/rich-posts/:postId kasuje też wpisy feedu (cascade)', async (t) => {
  let feedDeleted = false;
  t.mock.method(RichPost, 'deleteOne', async () => ({ deletedCount: 1 }));
  t.mock.method(UserFeedEntry, 'deleteMany', async () => { feedDeleted = true; return { deletedCount: 5 }; });

  const res = await request(createApp()).delete('/api/internal/rich-posts/55');
  assert.equal(res.status, 204);
  assert.equal(feedDeleted, true, 'feed powinien być wyczyszczony razem z postem');
});

test('DELETE /api/internal/rich-posts/:postId returns 500 when DB fails', async (t) => {
  t.mock.method(RichPost, 'deleteOne', async () => { throw new Error('mongo down'); });

  const res = await request(createApp()).delete('/api/internal/rich-posts/1');
  assert.equal(res.status, 500);
  assert.equal(res.body.code, 'MONGO_DELETE_FAILED');
});
