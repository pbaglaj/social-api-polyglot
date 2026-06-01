import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import analyticsRoutes from '../routes/analyticsRoutes.js';
import { UserFeedEntry } from '../models/UserFeedEntry.js';
import { ActivityDaily } from '../models/ActivityDaily.js';

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', analyticsRoutes);
  return app;
};

// Pomocnik: ustawia/resetuje fake-owy native MongoDB klient na globalThis,
// żeby endpointy /system-logs miały do czego sięgnąć bez realnego połączenia.
type FakeCollection = {
  insertOne: (doc: any) => Promise<{ insertedId: any }>;
  find: (q: any) => any;
};

const setFakeNativeDb = (collection: FakeCollection) => {
  (globalThis as any).nativeDb = { collection: () => collection };
};

const clearFakeNativeDb = () => {
  delete (globalThis as any).nativeDb;
};

// ========== /api/analytics/trending ==========

test('GET /api/analytics/trending returns trending list', async (t) => {
  const mockTrending = [{ postId: 10, reach: 2, averageScore: 1.5 }];
  t.mock.method(UserFeedEntry, 'aggregate', async () => mockTrending);

  const res = await request(createApp()).get('/api/analytics/trending');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.trending, mockTrending);
});

test('GET /api/analytics/trending returns 500 on aggregation error', async (t) => {
  t.mock.method(UserFeedEntry, 'aggregate', async () => { throw new Error('pipeline broken'); });
  const res = await request(createApp()).get('/api/analytics/trending');
  assert.equal(res.status, 500);
  assert.equal(res.body.code, 'ANALYTICS_FAILED');
});

// ========== /api/analytics/top-authors-weekly ==========

test('GET /api/analytics/top-authors-weekly returns ranked authors', async (t) => {
  const mockAuthors = [
    { authorId: 1, totalPosts: 10, samplePostId: 100, attachmentsCount: 2 },
    { authorId: 2, totalPosts: 5, samplePostId: 200, attachmentsCount: 0 }
  ];
  t.mock.method(ActivityDaily, 'aggregate', async () => mockAuthors);

  const res = await request(createApp()).get('/api/analytics/top-authors-weekly');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.topAuthors, mockAuthors);
});

test('GET /api/analytics/top-authors-weekly returns 500 on error', async (t) => {
  t.mock.method(ActivityDaily, 'aggregate', async () => { throw new Error('aggregate exploded'); });
  const res = await request(createApp()).get('/api/analytics/top-authors-weekly');
  assert.equal(res.status, 500);
  assert.equal(res.body.code, 'TOP_AUTHORS_FAILED');
});

// ========== /api/analytics/reaction-distribution ==========

test('GET /api/analytics/reaction-distribution returns aggregated reactions', async (t) => {
  const mockDistribution = [
    { reactionType: 'like', totalCount: 15 },
    { reactionType: 'heart', totalCount: 5 }
  ];
  t.mock.method(ActivityDaily, 'aggregate', async () => mockDistribution);

  const res = await request(createApp()).get('/api/analytics/reaction-distribution');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.distribution, mockDistribution);
});

test('GET /api/analytics/reaction-distribution returns 500 on error', async (t) => {
  t.mock.method(ActivityDaily, 'aggregate', async () => { throw new Error('boom'); });
  const res = await request(createApp()).get('/api/analytics/reaction-distribution');
  assert.equal(res.status, 500);
  assert.equal(res.body.code, 'REACTION_DISTR_FAILED');
});

// ========== /api/analytics/system-logs (native driver) ==========

test('POST /api/analytics/system-logs creates log (201)', async () => {
  const inserted: any[] = [];
  setFakeNativeDb({
    insertOne: async (doc: any) => { inserted.push(doc); return { insertedId: 'abc-123' }; },
    find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) })
  });

  const res = await request(createApp())
    .post('/api/analytics/system-logs')
    .send({ level: 'error', message: 'cos sie sypie', metadata: { src: 'demo' } });

  clearFakeNativeDb();
  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.id, 'abc-123');
  assert.equal(inserted[0].level, 'error');
  assert.equal(inserted[0].message, 'cos sie sypie');
});

test('POST /api/analytics/system-logs uses defaults when fields missing', async () => {
  const inserted: any[] = [];
  setFakeNativeDb({
    insertOne: async (doc: any) => { inserted.push(doc); return { insertedId: 'def' }; },
    find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) })
  });

  const res = await request(createApp())
    .post('/api/analytics/system-logs')
    .send({});

  clearFakeNativeDb();
  assert.equal(res.status, 201);
  assert.equal(inserted[0].level, 'info');
  assert.equal(inserted[0].message, '');
});

test('POST /api/analytics/system-logs returns 500 when native DB unavailable', async () => {
  clearFakeNativeDb();
  const res = await request(createApp())
    .post('/api/analytics/system-logs')
    .send({ level: 'info', message: 'x' });
  assert.equal(res.status, 500);
  assert.equal(res.body.code, 'LOG_WRITE_FAILED');
});

test('GET /api/analytics/system-logs returns recent logs', async () => {
  const mockLogs = [
    { level: 'error', message: 'a', timestamp: new Date() },
    { level: 'info', message: 'b', timestamp: new Date() }
  ];
  setFakeNativeDb({
    insertOne: async () => ({ insertedId: 'x' }),
    find: () => ({
      sort: () => ({ limit: () => ({ toArray: async () => mockLogs }) })
    })
  });

  const res = await request(createApp()).get('/api/analytics/system-logs');
  clearFakeNativeDb();
  assert.equal(res.status, 200);
  assert.equal(res.body.logs.length, 2);
});

test('GET /api/analytics/system-logs returns 500 when native DB unavailable', async () => {
  clearFakeNativeDb();
  const res = await request(createApp()).get('/api/analytics/system-logs');
  assert.equal(res.status, 500);
  assert.equal(res.body.code, 'NATIVE_QUERY_FAILED');
});
