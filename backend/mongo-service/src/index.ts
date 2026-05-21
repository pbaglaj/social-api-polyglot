import express from 'express';
import rateLimit from 'express-rate-limit';
import { connectDB } from './config/index.js';
import internalRoutes from './routes/internalRoutes.js';
import feedRoutes from './routes/feedRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import { errorHandler } from './middlewares/errorHandler.js';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too Many Requests', code: 429, details: 'Exceeded rate limit. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', apiLimiter);

app.use('/api/internal', internalRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use(errorHandler);

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Mongo Service running on port ${PORT}`);
  });
});
