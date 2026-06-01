import { seedDatabase } from '../prisma/seed.js';
import { describe, it, expect, jest } from '@jest/globals';

describe('Data Base - Database Seeder', () => {
  it('Should generate random users, posts, comments and relationships', async () => {
    // Jawnie typujemy funkcje tworzone przez jest.fn()
    const mockPrisma = {
      user: { create: jest.fn<(...args: any[]) => Promise<{ id: number }>>().mockResolvedValue({ id: Math.floor(Math.random() * 1000) }) },
      post: { create: jest.fn<(...args: any[]) => Promise<{ id: number }>>().mockResolvedValue({ id: Math.floor(Math.random() * 1000) }) },
      comment: { create: jest.fn<(...args: any[]) => Promise<{ id: number }>>().mockResolvedValue({ id: Math.floor(Math.random() * 1000) }) },
      follow: { create: jest.fn<(...args: any[]) => Promise<{ id: number }>>().mockResolvedValue({ id: Math.floor(Math.random() * 1000) }) },
    };

    // Rzutujemy mocka na 'any' przy wywołaniu funkcji, aby TypeScript 
    // nie narzekał na brak pozostałych właściwości PrismaClient
    await seedDatabase(mockPrisma as any);

    // Weryfikacja
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(10);
    expect(mockPrisma.post.create).toHaveBeenCalledTimes(10);
    expect(mockPrisma.comment.create).toHaveBeenCalledTimes(10);
    expect(mockPrisma.follow.create).toHaveBeenCalledTimes(10);
  });
});