import type { Request, Response, NextFunction } from 'express';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Błąd:', err);

  // Domyślny błąd
  let status = 500;
  let response = {
    error: 'Internal Server Error',
    code: 'INTERNAL_ERROR',
    details: err.message || null,
  };

  // Mapowanie błędów Prisma (PostgreSQL) - Wymóg T1
  if (err instanceof PrismaClientKnownRequestError) {
    if (err.code === 'P2002') { // Naruszenie unikalności (np. PG 23505)
      status = 409;
      response = { error: 'Conflict', code: 'P2002', details: `Unikalność naruszona dla pól: ${err.meta?.target}` };
    } else if (err.code === 'P2003') { // Błąd klucza obcego (np. PG 23503)
      status = 400;
      response = { error: 'Bad Request', code: 'P2003', details: 'Nieprawidłowe powiązanie relacyjne (klucz obcy).' };
    } else {
      status = 400;
      response = { error: 'Database Error', code: err.code, details: 'Błąd operacji bazodanowej.' };
    }
  } 
  // Własne błędy walidacji
  else if (err.name === 'ValidationError') {
    status = 400;
    response = { error: 'Validation Error', code: 'VALIDATION_FAILED', details: err.message };
  }

  // Wymóg T14: Brak wycieku stack trace do klienta
  res.status(status).json(response);
};