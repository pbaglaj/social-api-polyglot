import type { Request, Response, NextFunction } from 'express';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

// Mapowanie kodów PostgreSQL na HTTP status codes i komunikaty
const PG_ERROR_CODE_MAP: Record<string, { status: number; error: string; message: string }> = {
  '23505': { // unique_violation
    status: 409,
    error: 'Conflict',
    message: 'Naruszenie warunku unikalności (UNIQUE constraint violation).',
  },
  '23503': { // foreign_key_violation
    status: 400,
    error: 'Bad Request',
    message: 'Naruszenie warunku klucza obcego (FOREIGN KEY constraint violation).',
  },
  '23502': { // not_null_violation
    status: 400,
    error: 'Bad Request',
    message: 'Pole wymagane nie może być NULL.',
  },
  '23514': { // check_violation
    status: 400,
    error: 'Bad Request',
    message: 'Naruszenie warunku CHECK.',
  },
  '42P01': { // undefined_table
    status: 404,
    error: 'Not Found',
    message: 'Tabela nie istnieje w bazie danych.',
  },
  '42703': { // undefined_column
    status: 400,
    error: 'Bad Request',
    message: 'Kolumna nie istnieje w tabeli.',
  },
  '08006': { // connection_failure
    status: 503,
    error: 'Service Unavailable',
    message: 'Utrata połączenia z bazą danych.',
  },
};

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Błąd:', err);

  // Domyślny błąd
  let status = 500;
  let response = {
    error: 'Internal Server Error',
    code: 'INTERNAL_ERROR',
    details: err.message || null,
  };

  // Mapowanie błędów Prisma (PostgreSQL) - Wymóg: singleton, parametryzowane zapytania, mapowanie kodów
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
  // Mapowanie natywnych kodów błędów PostgreSQL (dla raw queries i bezpośrednich błędów)
  else if (err.code && typeof err.code === 'string' && err.code in PG_ERROR_CODE_MAP) {
    const pgErrorInfo = PG_ERROR_CODE_MAP[err.code as keyof typeof PG_ERROR_CODE_MAP];
    
    if (pgErrorInfo) { // This "narrows" the type and removes the 'possibly undefined' error
        status = pgErrorInfo.status;
        response = {
          error: pgErrorInfo.error,
          code: err.code,
          details: pgErrorInfo.message,
        };
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