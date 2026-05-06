import { PrismaClient } from '@prisma/client';

const prismaClientSingleton = () => {
  const datasourceUrl = process.env.DATABASE_URL;

  if (!datasourceUrl) {
    throw new Error(`Brak zmiennej środowiskowej bazy danych`);
  }

  const base = new PrismaClient({
    datasources: {
      db: {
        url: datasourceUrl,
      },
    },
    log: process.env.PRISMA_LOGGING === 'true'
      ? ['query', 'info', 'warn', 'error']
      : ['warn', 'error'],
  });

  // Client Extension: domain hook for user.create
  const extended = base.$extends({
    query: {
      user: {
        async create({ args, query }: any) {
          try {
            if (args && args.data && args.data.email) {
              args.data.email = String(args.data.email).toLowerCase();
            }

            if (args && args.data && args.data.username) {
              console.log(`[Hook] Przygotowuję do zapisu usera: ${args.data.username}`);
            }
          } catch (e) {
            console.warn('[Prisma hook] error normalizing user.create args', e);
          }

          return query(args);
        },
      },
    },
  });

  return extended;
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