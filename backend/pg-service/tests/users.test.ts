import { beforeEach, afterEach, describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { createApp } from './appSetup.js';
import prisma from '../src/config/prisma.js';

const app = createApp();

global.fetch = (async () => ({
  ok: true,
  json: async () => ({ success: true, message: 'Mocked' })
} as Response)) as unknown as typeof fetch;

const USERS = [
  { id: 1, username: 'JanKowalski', email: 'jan.kowalski@example.com', createdAt: new Date() },
  { id: 2, username: 'AnnaNowak', email: 'anna.nowak@example.com', createdAt: new Date() },
  { id: 3, username: 'Tomek', email: 'tomek@example.com', createdAt: new Date() }
];

describe('User Routes Tests', () => {
  beforeEach(() => {
    jest.spyOn(prisma.user, 'findMany').mockResolvedValue(USERS as any);
  });
  afterEach(() => { jest.restoreAllMocks(); });

  // ============== GET /api/users ==============
  describe('GET /api/users', () => {
    it('zwraca wszystkich użytkowników bez filtrów', async () => {
      const res = await request(app).get('/api/users');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.users).toHaveLength(3);
    });

    it('filtruje po username (case-insensitive)', async () => {
      const res = await request(app).get('/api/users?username=Anna');
      expect(res.status).toBe(200);
    });

    it('filtruje po email', async () => {
      const res = await request(app).get('/api/users?email=tomek@example.com');
      expect(res.status).toBe(200);
    });

    it('trimuje białe znaki w parametrach', async () => {
      const res = await request(app).get('/api/users?username=  AnnaNowak  ');
      expect(res.status).toBe(200);
    });

    it('zwraca pustą tablicę gdy brak dopasowania', async () => {
      jest.spyOn(prisma.user, 'findMany').mockResolvedValueOnce([] as any);
      const res = await request(app).get('/api/users?username=Nieistniejacy');
      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(0);
    });

    it('ignoruje parametr który nie jest stringiem', async () => {
      const res = await request(app).get('/api/users?username[]=a&username[]=b');
      expect(res.status).toBe(200);
    });
  });

  // ============== POST /api/users/:id/follow ==============
  describe('POST /api/users/:id/follow', () => {
    it('zwraca 400 dla niepoprawnego followee id (nie-numerycznego)', async () => {
      const res = await request(app).post('/api/users/abc/follow').send({ followerId: 1 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_FOLLOWEE_ID');
    });

    it('zwraca 400 gdy brak followerId', async () => {
      const res = await request(app).post('/api/users/2/follow').send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_FOLLOWER_ID');
    });

    it('zwraca 400 gdy followerId nie jest liczbą', async () => {
      const res = await request(app).post('/api/users/2/follow').send({ followerId: 'abc' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_FOLLOWER_ID');
    });

    it('blokuje self-follow (T18)', async () => {
      const res = await request(app).post('/api/users/1/follow').send({ followerId: 1 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SELF_FOLLOW');
    });

    it('zwraca 409 gdy relacja już istnieje', async () => {
      jest.spyOn(prisma.follow, 'findUnique').mockResolvedValue({
        id: 1, followerId: 1, followeeId: 2, createdAt: new Date()
      } as any);
      const res = await request(app).post('/api/users/2/follow').send({ followerId: 1 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ALREADY_FOLLOWING');
    });

    it('zwraca 409 gdy baza zwraca P2002 (race condition)', async () => {
      jest.spyOn(prisma.follow, 'findUnique').mockResolvedValue(null);
      const p2002 = new PrismaClientKnownRequestError('unique', {
        code: 'P2002', clientVersion: 'test', meta: { target: ['followerId_followeeId'] }
      });
      jest.spyOn(prisma.follow, 'create').mockRejectedValue(p2002);
      const res = await request(app).post('/api/users/2/follow').send({ followerId: 1 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ALREADY_FOLLOWING');
    });

    it('tworzy relację i zwraca 201', async () => {
      jest.spyOn(prisma.follow, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prisma.follow, 'create').mockResolvedValue({
        id: 10, followerId: 1, followeeId: 2, createdAt: new Date()
      } as any);
      const res = await request(app).post('/api/users/2/follow').send({ followerId: 1 });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.follow.id).toBe(10);
    });

    it('akceptuje followerId jako string numeryczny', async () => {
      jest.spyOn(prisma.follow, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prisma.follow, 'create').mockResolvedValue({
        id: 11, followerId: 1, followeeId: 2, createdAt: new Date()
      } as any);
      const res = await request(app).post('/api/users/2/follow').send({ followerId: '1' });
      expect(res.status).toBe(201);
    });
  });

  // ============== DELETE /api/users/:id/follow ==============
  describe('DELETE /api/users/:id/follow', () => {
    it('zwraca 400 dla niepoprawnego followee id', async () => {
      const res = await request(app).delete('/api/users/abc/follow').send({ followerId: 1 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_FOLLOWEE_ID');
    });

    it('zwraca 400 gdy brak followerId', async () => {
      const res = await request(app).delete('/api/users/2/follow').send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_FOLLOWER_ID');
    });

    it('zwraca 404 gdy relacja nie istnieje', async () => {
      jest.spyOn(prisma.follow, 'deleteMany').mockResolvedValue({ count: 0 } as any);
      const res = await request(app).delete('/api/users/2/follow').send({ followerId: 1 });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('FOLLOW_NOT_FOUND');
    });

    it('zwraca 204 gdy usuwa relację', async () => {
      jest.spyOn(prisma.follow, 'deleteMany').mockResolvedValue({ count: 1 } as any);
      const res = await request(app).delete('/api/users/2/follow').send({ followerId: 1 });
      expect(res.status).toBe(204);
    });
  });
});
