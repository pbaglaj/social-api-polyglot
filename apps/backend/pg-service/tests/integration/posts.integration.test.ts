import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../appSetup.js';
import prisma from '../../src/config/prisma.js';

// Bramka: testy integracyjne odpalaja sie tylko gdy jawnie wlaczone (RUN_INTEGRATION=true).
// Wymagaja realnego Postgresa z zaaplikowanymi migracjami. Default `npm test` (z mockami)
// nadal dziala bez zadnej bazy.
const runIntegration = process.env.RUN_INTEGRATION === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('Integration: pg-service vs realny PostgreSQL', () => {
  let userId: number;
  let secondUserId: number;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    // Mockujemy HTTP do mongo-service — testujemy tylko strone PG. Bez tego POST /api/posts
    // probowalby uderzyc do http://mongo-service:3002 i kompensacja usunelaby posta.
    global.fetch = jest.fn(
      async () => ({ ok: true, json: async () => ({ success: true }) } as Response)
    ) as unknown as typeof fetch;

    // Czysta baza przed seria testow.
    await prisma.reaction.deleteMany();
    await prisma.comment.deleteMany();
    await prisma.follow.deleteMany();
    await prisma.post.deleteMany();
    await prisma.user.deleteMany();

    const u1 = await prisma.user.create({
      data: { username: 'integ_user_a', email: 'integ_a@test.local' }
    });
    const u2 = await prisma.user.create({
      data: { username: 'integ_user_b', email: 'integ_b@test.local' }
    });
    userId = u1.id;
    secondUserId = u2.id;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await prisma.reaction.deleteMany();
    await prisma.comment.deleteMany();
    await prisma.follow.deleteMany();
    await prisma.post.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  it('POST /api/posts faktycznie zapisuje wiersz w PG', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/posts')
      .send({ authorId: userId, bodyPreview: 'realny post integracyjny' });

    expect(res.status).toBe(201);
    expect(res.body.bodyPreview).toBe('realny post integracyjny');

    const fromDb = await prisma.post.findFirst({
      where: { authorId: userId, bodyPreview: 'realny post integracyjny' }
    });
    expect(fromDb).not.toBeNull();
  });

  it('Idempotentne dodawanie reakcji — drugie wywolanie nie tworzy duplikatu', async () => {
    const post = await prisma.post.create({
      data: { authorId: userId, bodyPreview: 'post pod reakcje' }
    });
    const app = createApp();

    const r1 = await request(app)
      .post(`/api/posts/${post.id}/reactions`)
      .send({ userId: secondUserId, type: 'LIKE' });
    expect(r1.status).toBe(200);

    const r2 = await request(app)
      .post(`/api/posts/${post.id}/reactions`)
      .send({ userId: secondUserId, type: 'HEART' });
    expect(r2.status).toBe(200);

    const count = await prisma.reaction.count({
      where: { postId: post.id, userId: secondUserId }
    });
    expect(count).toBe(1);
  });

  it('Follow + Unfollow rzeczywiscie tworzy i kasuje wiersz w tabeli Follow', async () => {
    const app = createApp();

    const followRes = await request(app)
      .post(`/api/users/${secondUserId}/follow`)
      .send({ followerId: userId });
    expect(followRes.status).toBe(201);

    const exists = await prisma.follow.findUnique({
      where: { followerId_followeeId: { followerId: userId, followeeId: secondUserId } }
    });
    expect(exists).not.toBeNull();

    const unfollowRes = await request(app)
      .delete(`/api/users/${secondUserId}/follow`)
      .send({ followerId: userId });
    expect(unfollowRes.status).toBe(204);

    const after = await prisma.follow.findUnique({
      where: { followerId_followeeId: { followerId: userId, followeeId: secondUserId } }
    });
    expect(after).toBeNull();
  });

  it('Self-follow jest blokowany przez warstwe biznesowa (nie przez baze)', async () => {
    const app = createApp();
    const res = await request(app)
      .post(`/api/users/${userId}/follow`)
      .send({ followerId: userId });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SELF_FOLLOW');
  });

  it('Usuniecie posta kaskadowo usuwa komentarze i reakcje (wymog T18)', async () => {
    const post = await prisma.post.create({
      data: { authorId: userId, bodyPreview: 'post do usuniecia' }
    });
    await prisma.comment.create({
      data: { postId: post.id, authorId: secondUserId, content: 'komentarz' }
    });
    await prisma.reaction.create({
      data: { postId: post.id, userId: secondUserId, type: 'LIKE' }
    });

    const app = createApp();
    const res = await request(app)
      .delete(`/api/posts/${post.id}`)
      .send({ requesterId: userId });
    expect(res.status).toBe(204);

    const commentCount = await prisma.comment.count({ where: { postId: post.id } });
    const reactionCount = await prisma.reaction.count({ where: { postId: post.id } });
    const postExists = await prisma.post.findUnique({ where: { id: post.id } });

    expect(commentCount).toBe(0);
    expect(reactionCount).toBe(0);
    expect(postExists).toBeNull();
  });
});
