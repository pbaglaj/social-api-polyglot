import type { Request, Response, NextFunction } from 'express';
import { getRedis } from '../config/redis.js';

const DEFAULT_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 30);

export function cacheGet(prefix: string, ttlSeconds: number = DEFAULT_TTL_SECONDS) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') return next();

    const key = `${prefix}:${req.originalUrl}`;
    let redis;
    try {
      redis = await getRedis();
    } catch {
      res.setHeader('X-Cache', 'BYPASS');
      return next();
    }

    try {
      const cached = await redis.get(key);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('Content-Type', 'application/json');
        return res.send(cached);
      }
    } catch {
      res.setHeader('X-Cache', 'BYPASS');
      return next();
    }

    res.setHeader('X-Cache', 'MISS');
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      try {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          void redis.setEx(key, ttlSeconds, JSON.stringify(body)).catch(() => {});
        }
      } catch {}
      return originalJson(body);
    }) as Response['json'];
    return next();
  };
}

export async function invalidatePrefix(prefix: string): Promise<void> {
  try {
    const redis = await getRedis();
    let cursor = 0;
    do {
      const reply = await redis.scan(cursor, { MATCH: `${prefix}:*`, COUNT: 100 });
      cursor = reply.cursor;
      if (reply.keys.length > 0) {
        await redis.del(reply.keys);
      }
    } while (cursor !== 0);
  } catch {
    // best-effort
  }
}
