import type { Request, Response, NextFunction } from 'express';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

// Mapowanie kodów PostgreSQL na HTTP status codes (T1).
// Wartości obowiązują zarówno dla błędów natywnych (sterownik pg, Knex),
// jak i tunelowanych przez Sequelize w `error.parent`.
const PG_ERROR_CODE_MAP: Record<string, { status: number; error: string; message: string }> = {
  '23505': { status: 409, error: 'Conflict', message: 'Naruszenie warunku unikalności (UNIQUE constraint violation).' },
  '23503': { status: 400, error: 'Bad Request', message: 'Naruszenie warunku klucza obcego (FOREIGN KEY constraint violation).' },
  '23502': { status: 400, error: 'Bad Request', message: 'Pole wymagane nie może być NULL.' },
  '23514': { status: 400, error: 'Bad Request', message: 'Naruszenie warunku CHECK.' },
  '42P01': { status: 404, error: 'Not Found', message: 'Tabela nie istnieje w bazie danych.' },
  '42703': { status: 400, error: 'Bad Request', message: 'Kolumna nie istnieje w tabeli.' },
  '22P02': { status: 400, error: 'Bad Request', message: 'Nieprawidłowa reprezentacja tekstowa (np. niepoprawny UUID/INT).' },
  '08006': { status: 503, error: 'Service Unavailable', message: 'Utrata połączenia z bazą danych.' },
  '08003': { status: 503, error: 'Service Unavailable', message: 'Połączenie nie istnieje.' },
};

function pickPgCode(err: any): string | undefined {
  if (!err) return undefined;
  if (typeof err.code === 'string' && err.code in PG_ERROR_CODE_MAP) return err.code;
  if (err.parent && typeof err.parent.code === 'string' && err.parent.code in PG_ERROR_CODE_MAP) return err.parent.code;
  if (err.original && typeof err.original.code === 'string' && err.original.code in PG_ERROR_CODE_MAP) return err.original.code;
  return undefined;
}

export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (process.env.NODE_ENV !== 'test') {
    console.error('Błąd:', err);
  }

  // Default
  let status = 500;
  let response: { error: string; code: string; details: string | null } = {
    error: 'Internal Server Error',
    code: 'INTERNAL_ERROR',
    details: err?.message || null,
  };

  // Sequelize - walidacja (T3)
  if (err?.name === 'SequelizeValidationError' || err?.name === 'SequelizeUniqueConstraintError') {
    const messages = Array.isArray(err.errors)
      ? err.errors.map((e: any) => e.message).join('; ')
      : err.message;
    status = err.name === 'SequelizeUniqueConstraintError' ? 409 : 400;
    return res.status(status).json({
      error: status === 409 ? 'Conflict' : 'Validation Error',
      code: err.name,
      details: messages,
    });
  }

  // Sequelize - błąd FK / DB
  if (err?.name === 'SequelizeForeignKeyConstraintError') {
    return res.status(400).json({
      error: 'Bad Request',
      code: 'SequelizeForeignKeyConstraintError',
      details: 'Nieprawidłowe powiązanie relacyjne (klucz obcy).',
    });
  }

  // Prisma - znane błędy
  if (err instanceof PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: 'Conflict',
        code: 'P2002',
        details: `Unikalność naruszona dla pól: ${err.meta?.target}`,
      });
    }
    if (err.code === 'P2003') {
      return res.status(400).json({
        error: 'Bad Request',
        code: 'P2003',
        details: 'Nieprawidłowe powiązanie relacyjne (klucz obcy).',
      });
    }
    return res.status(400).json({
      error: 'Database Error',
      code: err.code,
      details: 'Błąd operacji bazodanowej.',
    });
  }

  // pg / Knex / Sequelize.parent - natywne kody PG
  const pgCode = pickPgCode(err);
  if (pgCode) {
    const info = PG_ERROR_CODE_MAP[pgCode]!;
    return res.status(info.status).json({
      error: info.error,
      code: pgCode,
      details: info.message,
    });
  }

  // Własne walidacje (instance of ValidationError z validators.ts)
  if (err?.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'VALIDATION_FAILED',
      details: err.message,
    });
  }

  // T14: nie wyciekamy stack trace do klienta
  res.status(status).json(response);
};
