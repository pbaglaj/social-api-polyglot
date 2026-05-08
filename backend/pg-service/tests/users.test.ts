import { beforeAll, afterAll, describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from './appSetup.js';
import prisma from '../src/db.js';

const app = createApp();

global.fetch = jest.fn(
  async () => ({ ok: true, json: async () => ({ success: true, message: 'Mocked' }) } as Response)
) as unknown as typeof fetch;

describe('User Routes Tests', () => {
  beforeAll(() => {
    jest.spyOn(prisma.follow, 'create').mockResolvedValue({ id: 1, followerId: 1, followeeId: 2, createdAt: new Date() });
    jest.spyOn(prisma.follow, 'findUnique').mockResolvedValue(null);
    jest.spyOn(prisma.user, 'findMany').mockResolvedValue([
      { id: 1, username: 'JanKowalski', email: 'jan.kowalski@example.com', createdAt: new Date() },
      { id: 2, username: 'AnnaNowak', email: 'anna.nowak@example.com', createdAt: new Date() },
      { id: 3, username: 'Tomek', email: 'tomek@example.com', createdAt: new Date() }
    ] as any);
  });
  afterAll(async () => jest.restoreAllMocks());

  it('Powinien zablokować obserwowanie samego siebie (Wymóg T18 - Self-follow)', async () => {
    const res = await request(app).post('/api/users/1/follow').send({ followerId: 1 }); 
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SELF_FOLLOW');
  });

  it('powinien zwrócić wszystkich użytkowników, gdy brak parametrów', async () => {
    const response = await request(app).get('/api/users');
    expect(response.status).toBe(200);
    expect(response.body.users).toHaveLength(3);
  });

  it('powinien filtrować po nazwie użytkownika', async () => {
    const response = await request(app).get('/api/users?username=Anna');
    expect(response.status).toBe(200);
  });

  it('powinien filtrować po emailu', async () => {
    const response = await request(app).get('/api/users?email=tomek@example.com');
    expect(response.status).toBe(200);
  });

  it('powinien usunąć białe znaki z parametrów (trim)', async () => {
    const response = await request(app).get('/api/users?username=  AnnaNowak  ');
    expect(response.status).toBe(200);
  });
  
  it('powinien zwrócić pustą tablicę, gdy nikt nie pasuje', async () => {
    jest.spyOn(prisma.user, 'findMany').mockResolvedValueOnce([]);
    const response = await request(app).get('/api/users?username=Nieistniejacy');
    expect(response.status).toBe(200);
    expect(response.body.users).toHaveLength(0);
  });
});
