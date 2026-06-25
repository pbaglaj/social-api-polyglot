import express from 'express';
import postRoutes from '../src/routes/postRoutes.js';
import userRoutes from '../src/routes/userRoutes.js';
import statsRoutes from '../src/routes/statsRoutes.js';
import tagsRoutes from '../src/routes/tagsRoutes.js';
import notificationsRoutes from '../src/routes/notificationsRoutes.js';
import adminRoutes from '../src/routes/adminRoutes.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';

export const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/posts', postRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/stats', statsRoutes);
  app.use('/api/tags', tagsRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use(errorHandler);
  return app;
};
