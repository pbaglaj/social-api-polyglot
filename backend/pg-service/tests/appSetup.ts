import express from 'express';
import postRoutes from '../src/postRoutes.js';
import userRoutes from '../src/userRoutes.js';
import statsRoutes from '../src/statsRoutes.js';
import tagsRoutes from '../src/tagsRoutes.js';
import notificationsRoutes from '../src/notificationsRoutes.js';
import { errorHandler } from '../src/errorHandler.js';

export const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/posts', postRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/stats', statsRoutes);
  app.use('/api/tags', tagsRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use(errorHandler);
  return app;
};
