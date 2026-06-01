import express from 'express';
import rateLimit from 'express-rate-limit';
import { connectDB } from './config/index.js';
import { disconnectMongoose } from './config/mongoose.js';
import { disconnectNativeClient } from './config/nativeClient.js';
import internalRoutes from './routes/internalRoutes.js';
import feedRoutes from './routes/feedRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import healthRoutes from './routes/healthRoutes.js';
import { metricsMiddleware, metricsHandler } from './middlewares/metrics.js';
import { errorHandler } from './middlewares/errorHandler.js';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

// Obserwowalnosc: zliczanie zadan HTTP + ekspozycja /metrics dla Prometheusa.
app.use(metricsMiddleware);
app.get('/metrics', metricsHandler);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too Many Requests', code: 429, details: 'Exceeded rate limit. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/health', healthRoutes);

app.use('/api', apiLimiter);

app.use('/api/internal', internalRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use(errorHandler);

connectDB().then(() => {
  const server = app.listen(PORT, () => {
    console.log(`Mongo Service running on port ${PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[shutdown] received ${signal}, closing connections...`);
    const closeTimeout = setTimeout(() => {
      console.error('[shutdown] forced exit after 25s');
      process.exit(1);
    }, 25_000);

    server.close(() => console.log('[shutdown] HTTP server closed'));

    await Promise.allSettled([
      disconnectMongoose().then(() => console.log('[shutdown] Mongoose closed')),
      disconnectNativeClient().then(() => console.log('[shutdown] Mongo native client closed')),
    ]);

    clearTimeout(closeTimeout);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
});
