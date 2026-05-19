import pg from 'pg';

const { Pool } = pg;

const globalForPg = globalThis as unknown as {
  pgPool?: pg.Pool;
  pgSigintInstalled?: boolean;
};

function createPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Brak zmiennej DATABASE_URL dla puli pg.');
  }

  const pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (err) => {
    console.error('[pg pool] nieoczekiwany błąd klienta puli:', err.message);
  });

  return pool;
}

function getPool(): pg.Pool {
  if (!globalForPg.pgPool) {
    globalForPg.pgPool = createPool();
    if (!globalForPg.pgSigintInstalled) {
      process.on('SIGINT', async () => {
        try {
          await globalForPg.pgPool?.end();
          console.log('[pg pool] zamknięto pulę połączeń (SIGINT).');
        } catch (e) {
          console.error('[pg pool] błąd zamykania puli:', e);
        }
      });
      globalForPg.pgSigintInstalled = true;
    }
  }
  return globalForPg.pgPool;
}

// Proxy: lazy connection - faktyczne tworzenie puli następuje przy pierwszym .query().
const pgPool = {
  query: (text: string, params?: unknown[]) =>
    (getPool() as any).query(text, params as any),
  end: () => getPool().end(),
  on: (event: string, listener: (...a: any[]) => void) =>
    (getPool() as any).on(event, listener),
} as unknown as pg.Pool;

export default pgPool;
