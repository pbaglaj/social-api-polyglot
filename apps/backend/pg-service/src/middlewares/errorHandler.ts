import type { Request, Response, NextFunction } from 'express';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PG_ERROR_CODE_MAP, pickPgCode } from '../utils/errorMapper.js';

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

  // pg / Knex / Sequelize.parent - natywne kody PG (T1)
  const pgCode = pickPgCode(err);
  if (pgCode) {
    const info = PG_ERROR_CODE_MAP[pgCode]!;
    return res.status(info.status).json({
      error: info.error,
      code: pgCode,
      details: info.message,
    });
  }

  // Własne walidacje
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
