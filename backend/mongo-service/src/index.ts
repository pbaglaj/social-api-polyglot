import express from 'express';
import { connectDB } from './db.js';
import internalRoutes from './internalRoutes.js';
import 'dotenv/config'; 

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

// Rejestracja routera wewnętrznego
app.use('/api/internal', internalRoutes);

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Mongo Service działa na porcie ${PORT}`);
  });
});