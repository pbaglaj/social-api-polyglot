import express from 'express';
import postRoutes from '../src/postRoutes.js';
import userRoutes from '../src/userRoutes.js';
import { errorHandler } from '../src/errorHandler.js';

export const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/posts', postRoutes);
  app.use('/api/users', userRoutes);
  app.use(errorHandler);
  return app;
};
