import type { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { MongoServerError } from 'mongodb';

// Mongo-service error handler.
// Mapuje typowe błędy Mongoose / natywnego sterownika na HTTP.
// Spójna obwiednia JSON: { error, code, details }.
export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (process.env.NODE_ENV !== 'test') {
    console.error('Błąd:', err);
  }

  // Mongoose - walidacja schematu (T6)
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors)
      .map((e: any) => e?.message)
      .filter(Boolean)
      .join('; ');
    return res.status(400).json({
      error: 'Validation Error',
      code: 'MONGOOSE_VALIDATION_FAILED',
      details: details || err.message,
    });
  }

  // Mongoose - rzutowanie ObjectId / liczba itd.
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({
      error: 'Bad Request',
      code: 'MONGOOSE_CAST_ERROR',
      details: `Nieprawidłowa wartość dla pola "${err.path}".`,
    });
  }

  // Native driver - duplikat klucza (unique index)
  if (err instanceof MongoServerError && err.code === 11000) {
    return res.status(409).json({
      error: 'Conflict',
      code: 'DUPLICATE_KEY',
      details: 'Naruszenie warunku unikalności (duplicate key).',
    });
  }

  // Default - nie wyciekamy stack trace do klienta
  return res.status(500).json({
    error: 'Internal Server Error',
    code: 'INTERNAL_ERROR',
    details: err?.message || null,
  });
};
