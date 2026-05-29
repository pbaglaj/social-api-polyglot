import { createClient, type RedisClientType } from 'redis';

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;

// W testach (i wszędzie tam, gdzie świadomie wyłączamy cache) nie próbujemy
// łączyć się z Redisem. Bez tego getRedis() wisiałby w nieskończoność na
// reconnectStrategy, gdy host `redis` jest nieosiągalny (np. w CI jobie
// pg-service, gdzie działa tylko Postgres) — co zawieszało testy jest.
const REDIS_DISABLED =
  process.env.NODE_ENV === 'test' || process.env.REDIS_DISABLED === 'true';

export function getRedis(): Promise<RedisClientType> {
  if (REDIS_DISABLED) return Promise.reject(new Error('Redis disabled'));
  if (client && client.isOpen) return Promise.resolve(client);
  if (connecting) return connecting;

  const url = process.env.REDIS_URL || 'redis://redis:6379';
  const c: RedisClientType = createClient({
    url,
    socket: {
      // Ograniczamy czas pierwszego połączenia, żeby żądanie nie wisiało
      // w nieskończoność, gdy Redis jest niedostępny — cacheGet wtedy
      // łagodnie omija cache (X-Cache: BYPASS).
      connectTimeout: 2000,
      reconnectStrategy: (retries) => Math.min(retries * 100, 2000),
    },
  });
  c.on('error', (err) => console.warn('[redis] error:', err.message));

  connecting = c.connect().then(() => {
    client = c;
    connecting = null;
    console.log(`[redis] connected to ${url}`);
    return c;
  }).catch((err) => {
    connecting = null;
    console.warn('[redis] connect failed:', err.message);
    throw err;
  });

  return connecting;
}

export async function closeRedis(): Promise<void> {
  if (client && client.isOpen) {
    await client.quit();
    client = null;
  }
}
