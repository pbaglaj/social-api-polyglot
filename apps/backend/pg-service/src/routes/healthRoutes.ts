import { Router, type Request, type Response } from 'express';
import prisma from '../config/prisma.js';
import { getRedis, REDIS_DISABLED } from '../config/redis.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const checks: Record<string, { ok: boolean; error?: string; note?: string }> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = { ok: true };
  } catch (e) {
    checks.postgres = { ok: false, error: (e as Error).message };
  }

  if (REDIS_DISABLED) {
    // Redis to cache best-effort i bywa swiadomie wylaczony (NODE_ENV=test, E2E).
    // Wtedy nie degradujemy zdrowia serwisu - inaczej /health zwracalby 503,
    // a healthcheck compose oznaczalby kontener jako unhealthy.
    checks.redis = { ok: true, note: 'disabled' };
  } else {
    try {
      const redis = await getRedis();
      const pong = await redis.ping();
      checks.redis = { ok: pong === 'PONG' };
    } catch (e) {
      checks.redis = { ok: false, error: (e as Error).message };
    }
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    service: 'pg-service',
    checks,
    timestamp: new Date().toISOString(),
  });
});

export default router;
