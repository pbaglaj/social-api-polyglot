import { beforeAll, afterAll, describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import postRoutes from '../src/postRoutes';
import userRoutes from '../src/userRoutes';
import { errorHandler } from '../src/errorHandler';
import prisma from '../src/db';

// Konfiguracja testowej aplikacji Express
const app = express();
app.use(express.json());
app.use('/api/posts', postRoutes);
app.use('/api/users', userRoutes);
app.use(errorHandler);

// Mockowanie globalnego fetch (izolujemy serwis podczas testów)
global.fetch = jest.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
    ({
      ok: true,
      json: async () => ({ success: true, message: 'Mocked RichPost' }),
    } as Response)
) as unknown as typeof fetch;

describe('API Integration Tests (PG Service)', () => {
  beforeAll(() => {
    jest.spyOn(prisma.post, 'findMany').mockResolvedValue([]);
    jest.spyOn(prisma.follow, 'create').mockResolvedValue({ id: 1, followerId: 1, followeeId: 2, createdAt: new Date() });
    jest.spyOn(prisma.follow, 'findUnique').mockResolvedValue(null);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('1. Powinien zwrócić błąd walidacji przy zbyt długim podglądzie posta', async () => {
    const longText = 'a'.repeat(256);
    const res = await request(app)
      .post('/api/posts')
      .send({ authorId: 1, bodyPreview: longText });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('2. Powinien zablokować obserwowanie samego siebie (Wymóg T18 - Self-follow)', async () => {
    // followerId i followeeId (w URL) są takie same
    const res = await request(app)
      .post('/api/users/1/follow')
      .send({ followerId: 1 }); 

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SELF_FOLLOW');
  });

  it('3. Powinien zwrócić listę postów ze statusem 200', async () => {
    const res = await request(app).get('/api/posts');
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

});

describe('PostgreSQL Error Code Mapping Tests', () => {

  it('Powinien mapować kod 23505 (unique_violation) na HTTP 409 Conflict', async () => {
    const testApp = express();
    testApp.use(express.json());
    testApp.get('/test', (req, res, next) => {
      const err = new Error('Duplicate key value violates unique constraint');
      (err as any).code = '23505';
      next(err);
    });
    testApp.use(errorHandler);

    const res = await request(testApp).get('/test');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Conflict');
    expect(res.body.code).toBe('23505');
  });

  it('Powinien mapować kod 23503 (foreign_key_violation) na HTTP 400 Bad Request', async () => {
    const testApp = express();
    testApp.use(express.json());
    testApp.get('/test', (req, res, next) => {
      const err = new Error('Foreign key constraint violation');
      (err as any).code = '23503';
      next(err);
    });
    testApp.use(errorHandler);

    const res = await request(testApp).get('/test');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Bad Request');
    expect(res.body.code).toBe('23503');
  });

  it('Powinien mapować kod 23502 (not_null_violation) na HTTP 400 Bad Request', async () => {
    const testApp = express();
    testApp.use(express.json());
    testApp.get('/test', (req, res, next) => {
      const err = new Error('Null value not allowed');
      (err as any).code = '23502';
      next(err);
    });
    testApp.use(errorHandler);

    const res = await request(testApp).get('/test');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Bad Request');
    expect(res.body.code).toBe('23502');
  });

  it('Powinien mapować kod 08006 (connection_failure) na HTTP 503 Service Unavailable', async () => {
    const testApp = express();
    testApp.use(express.json());
    testApp.get('/test', (req, res, next) => {
      const err = new Error('Connection lost');
      (err as any).code = '08006';
      next(err);
    });
    testApp.use(errorHandler);

    const res = await request(testApp).get('/test');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Service Unavailable');
    expect(res.body.code).toBe('08006');
  });

});

describe('GET /api/users - Filtrowanie z dynamicznym WHERE', () => {
  // Zastępujemy rzeczywiste wywołania Prisma lekkojszymi stubami,
  // żeby testy mogły działać bez uruchomionego serwera PostgreSQL.
  const usersStore: Array<any> = [];

  beforeAll(() => {
    usersStore.length = 0;
    usersStore.push(
      { id: 1, username: 'JanKowalski', email: 'jan.kowalski@example.com', createdAt: new Date() },
      { id: 2, username: 'AnnaNowak', email: 'anna@test.pl', createdAt: new Date() },
      { id: 3, username: 'Tomasz_Jan', email: 'tomek@example.com', createdAt: new Date() },
    );

    jest.spyOn(prisma.user, 'deleteMany').mockImplementation((async () => {
      usersStore.length = 0;
      return { count: 0 };
    }) as any);

    jest.spyOn(prisma.user, 'createMany').mockImplementation((async ({ data }: any) => {
      data.forEach((d: any) => usersStore.push({ id: usersStore.length + 1, ...d, createdAt: new Date() }));
      return { count: data.length };
    }) as any);

    jest.spyOn(prisma.user, 'findMany').mockImplementation((async (args?: any) => {
      // Brak filtrów -> zwracamy wszystkie, posortowane malejąco po createdAt
      if (!args || !args.where || Object.keys(args.where).length === 0) {
        return usersStore.slice().sort((a, b) => +b.createdAt - +a.createdAt);
      }

      const where = args.where;
      return usersStore.filter((u) => {
        let ok = true;
        if (where.username && where.username.contains) {
          const needle = String(where.username.contains).toLowerCase();
          ok = ok && u.username.toLowerCase().includes(needle);
        }
        if (where.email && where.email.contains) {
          const needle = String(where.email.contains);
          ok = ok && u.email.includes(needle);
        }
        return ok;
      });
    }) as any);

    jest.spyOn(prisma, '$disconnect').mockResolvedValue(undefined as any);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('powinien zwrócić wszystkich użytkowników, gdy brak parametrów', async () => {
    const response = await request(app).get('/api/users');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.users).toHaveLength(3);
  });

  it('powinien filtrować po nazwie użytkownika (częściowe dopasowanie, ignoruje wielkość liter)', async () => {
    const response = await request(app).get('/api/users?username=jan');

    expect(response.status).toBe(200);
    expect(response.body.users).toHaveLength(2);

    const usernames = response.body.users.map((u: any) => u.username);
    expect(usernames).toContain('JanKowalski');
    expect(usernames).toContain('Tomasz_Jan');
  });

  it('powinien filtrować po emailu (częściowe dopasowanie)', async () => {
    const response = await request(app).get('/api/users?email=@example.com');

    expect(response.status).toBe(200);
    expect(response.body.users).toHaveLength(2);

    const emails = response.body.users.map((u: any) => u.email);
    expect(emails).toContain('jan.kowalski@example.com');
    expect(emails).toContain('tomek@example.com');
  });

  it('powinien łączyć parametry username i email', async () => {
    const response = await request(app).get('/api/users?username=Kowalski&email=@example.com');

    expect(response.status).toBe(200);
    expect(response.body.users).toHaveLength(1);
    expect(response.body.users[0].username).toBe('JanKowalski');
  });

  it('powinien usunąć białe znaki z parametrów (trim)', async () => {
    const response = await request(app).get('/api/users?username=  AnnaNowak  ');

    expect(response.status).toBe(200);
    expect(response.body.users).toHaveLength(1);
    expect(response.body.users[0].username).toBe('AnnaNowak');
  });

  it('powinien zwrócić pustą tablicę, gdy nikt nie pasuje', async () => {
    const response = await request(app).get('/api/users?username=NieistniejacyUzytkownik');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.users).toHaveLength(0);
  });

  describe('Komentarze (Wymóg T15)', () => {
    beforeAll(() => {
      jest.spyOn(prisma.comment, 'create').mockResolvedValue({
        id: 1,
        postId: 999,
        authorId: 1,
        parentId: null,
        content: 'Testowy komentarz',
        createdAt: new Date()
      } as any);

      jest.spyOn(prisma.comment, 'findMany').mockResolvedValue([
        {
          id: 1,
          postId: 999,
          authorId: 1,
          parentId: null,
          content: 'Testowy komentarz',
          createdAt: new Date(),
          author: { username: 'testuser' },
          replies: []
        }
      ] as any);
    });

    afterAll(() => {
      jest.restoreAllMocks();
    });

    it('Powinien dodać komentarz do posta (wątkowanie nullable)', async () => {
      const res = await request(app)
        .post('/api/posts/999/comments')
        .send({ authorId: 1, content: 'Testowy komentarz' });
      
      expect(res.status).toBe(201);
      expect(res.body.content).toBe('Testowy komentarz');
      expect(res.body.parentId).toBeNull();
    });

    it('Powinien zgłosić błąd walidacji przy pustym komentarzu', async () => {
      const res = await request(app)
        .post('/api/posts/999/comments')
        .send({ authorId: 1, content: '   ' });
      
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('Powinien pobrać komentarze dla danego posta', async () => {
      const res = await request(app).get('/api/posts/999/comments');
      
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].content).toBe('Testowy komentarz');
    });
  });

});
