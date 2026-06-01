import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { getNativeClient } from '../config/index.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const checks: Record<string, { ok: boolean; error?: string }> = {};

  try {
    const state = mongoose.connection.readyState;
    checks.mongoose = { ok: state === 1 };
    if (state !== 1) checks.mongoose.error = `readyState=${state}`;
  } catch (e) {
    checks.mongoose = { ok: false, error: (e as Error).message };
  }

  try {
    const client = getNativeClient();
    if (!client) {
      checks.mongo_native = { ok: false, error: 'client not initialized' };
    } else {
      const pingResult = await client.db().admin().ping();
      checks.mongo_native = { ok: pingResult?.ok === 1 };
    }
  } catch (e) {
    checks.mongo_native = { ok: false, error: (e as Error).message };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    service: 'mongo-service',
    checks,
    timestamp: new Date().toISOString(),
  });
});

export default router;
