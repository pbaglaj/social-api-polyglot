import express from 'express';
import rateLimit from 'express-rate-limit';
import { connectDB } from './db.js';
import internalRoutes from './internalRoutes.js';
import feedRoutes from './feedRoutes.js';          
import analyticsRoutes from './analyticsRoutes.js';
import 'dotenv/config'; 

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit 100 requests per IP within 15 minutes
  message: { error: 'Too Many Requests', code: 429, details: 'Exceeded rate limit. Try again later.' },
  standardHeaders: true, // Returns RateLimit-* headers
  legacyHeaders: false,
});

app.use('/api', apiLimiter); // Apply to all routes starting with /api

app.use('/api/internal', internalRoutes);
app.use('/api/feed', feedRoutes);           
app.use('/api/analytics', analyticsRoutes);

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Mongo Service running on port ${PORT}`);
  });
});