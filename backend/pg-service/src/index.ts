import express from 'express';
import postRoutes from './postRoutes.js';
import userRoutes from './userRoutes.js';
import { errorHandler } from './errorHandler.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware do parsowania JSON
app.use(express.json());

// Rejestracja routerów
app.use('/api/posts', postRoutes);
app.use('/api/users', userRoutes);
// Rejestracja globalnego handlera błędów
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`PG Service działa na porcie ${PORT}`);
});