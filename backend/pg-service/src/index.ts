import express from 'express';
import rateLimit from 'express-rate-limit';
import postRoutes from './routes/postRoutes.js';
import userRoutes from './routes/userRoutes.js';
import statsRoutes from './routes/statsRoutes.js';
import tagsRoutes from './routes/tagsRoutes.js';
import notificationsRoutes from './routes/notificationsRoutes.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { initSequelize } from './models/index.js';

const app = express();
const PORT = process.env.PORT || 3001;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || (process.env.NODE_ENV === 'production' ? 100 : 1000));

app.use(express.json());
app.set('trust proxy', 1);

const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  message: { error: 'Too Many Requests', code: 429, details: 'Exceeded request limit. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', apiLimiter);

app.use('/api/posts', postRoutes);
app.use('/api/users', userRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use(errorHandler);

(async () => {
  try {
    await initSequelize();
  } catch (e) {
    console.error('[sequelize] błąd inicjalizacji modeli:', e);
  }

  app.listen(PORT, () => {
    console.log(`PG Service is running on port ${PORT}`);
  });
})();
