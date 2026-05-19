import { createClient, type RedisClientType } from 'redis';

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;

export function getRedis(): Promise<RedisClientType> {
  if (client && client.isOpen) return Promise.resolve(client);
  if (connecting) return connecting;

  const url = process.env.REDIS_URL || 'redis://redis:6379';
  const c: RedisClientType = createClient({ url, socket: { reconnectStrategy: (retries) => Math.min(retries * 100, 2000) } });
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
