import { PrismaClient } from '@prisma/client';

const prismaClientSingleton = () => {
  const datasourceUrl = process.env.DATABASE_URL;

  if (!datasourceUrl) {
    throw new Error(`Brak zmiennej środowiskowej bazy danych`);
  }

  return new PrismaClient({
    datasources: {
      db: {
        url: datasourceUrl,
      },
    },
    log: process.env.PRISMA_LOGGING === 'true'
      ? ['query', 'info', 'warn', 'error']
      : ['warn', 'error'],
  });
};

type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

// Persist the Prisma client on globalThis to avoid creating
// multiple instances during hot-reloads or repeated imports.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClientSingleton;
};

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prismaClientSingleton();
}

const prisma = globalForPrisma.prisma as PrismaClientSingleton;

export default prisma;