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

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientSingleton | undefined;
};

const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

export default prisma;