import express from 'express';
import rateLimit from 'express-rate-limit';
import postRoutes from './routes/postRoutes.js';
import userRoutes from './routes/userRoutes.js';
import statsRoutes from './routes/statsRoutes.js';
import tagsRoutes from './routes/tagsRoutes.js';
import notificationsRoutes from './routes/notificationsRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import googleRoutes from './routes/googleRoutes.js';
import healthRoutes from './routes/healthRoutes.js';
import { metricsMiddleware, metricsHandler } from './middlewares/metrics.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { initSequelize } from './models/index.js';
import prisma from './config/prisma.js';
import sequelize from './config/sequelize.js';
import { closeRedis } from './config/redis.js';

const app = express();
const PORT = process.env.PORT || 3001;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || (process.env.NODE_ENV === 'production' ? 100 : 1000));

app.use(express.json());
app.set('trust proxy', 1);

// Obserwowalnosc: zliczanie zadan HTTP + ekspozycja /metrics dla Prometheusa.
app.use(metricsMiddleware);
app.get('/metrics', metricsHandler);

const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  message: { error: 'Too Many Requests', code: 429, details: 'Exceeded request limit. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/health', healthRoutes);

app.use('/api', apiLimiter);

app.use('/api/posts', postRoutes);
app.use('/api/users', userRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/google', googleRoutes);
app.use(errorHandler);

(async () => {
  try {
    await initSequelize();
  } catch (e) {
    console.error('[sequelize] błąd inicjalizacji modeli:', e);
  }

  const server = app.listen(PORT, () => {
    console.log(`PG Service is running on port ${PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[shutdown] received ${signal}, closing connections...`);
    const closeTimeout = setTimeout(() => {
      console.error('[shutdown] forced exit after 25s');
      process.exit(1);
    }, 25_000);

    server.close(() => console.log('[shutdown] HTTP server closed'));

    await Promise.allSettled([
      prisma.$disconnect().then(() => console.log('[shutdown] Prisma disconnected')),
      sequelize.close().then(() => console.log('[shutdown] Sequelize closed')),
      closeRedis().then(() => console.log('[shutdown] Redis closed')),
    ]);

    clearTimeout(closeTimeout);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
})();
