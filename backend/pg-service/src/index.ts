import express from 'express';
import rateLimit from 'express-rate-limit';
import postRoutes from './postRoutes.js';
import userRoutes from './userRoutes.js';
import { errorHandler } from './errorHandler.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware for parsing JSON and trusting proxy headers (if behind a reverse proxy)
app.use(express.json());
app.set('trust proxy', 1);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit 100 requests per IP within 15 minutes
  message: { error: 'Too Many Requests', code: 429, details: 'Exceeded request limit. Please try again later.' },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false,
});

app.use('/api', apiLimiter);

app.use('/api/posts', postRoutes);
app.use('/api/users', userRoutes);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`PG Service is running on port ${PORT}`);
});