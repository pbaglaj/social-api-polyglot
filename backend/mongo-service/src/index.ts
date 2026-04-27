import express from 'express';
import { connectDB } from './db.js';
import internalRoutes from './internalRoutes.js';
import feedRoutes from './feedRoutes.js';          
import analyticsRoutes from './analyticsRoutes.js';
import 'dotenv/config'; 

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

app.use('/api/internal', internalRoutes);
app.use('/api/feed', feedRoutes);           
app.use('/api/analytics', analyticsRoutes);

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Mongo Service działa na porcie ${PORT}`);
  });
});