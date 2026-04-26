import express from 'express';
import { connectDB } from './db.js';

// Musimy wczytać zmienne środowiskowe lokalnie
import 'dotenv/config'; 

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Mongo Service działa na porcie ${PORT}`);
  });
});