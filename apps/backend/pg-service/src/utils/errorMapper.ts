// Mapowanie kodów PostgreSQL na HTTP status codes (T1).
// Wartości obowiązują zarówno dla błędów natywnych (sterownik pg, Knex),
// jak i tunelowanych przez Sequelize w `error.parent`.
export const PG_ERROR_CODE_MAP: Record<string, { status: number; error: string; message: string }> = {
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

export function pickPgCode(err: any): string | undefined {
  if (!err) return undefined;
  if (typeof err.code === 'string' && err.code in PG_ERROR_CODE_MAP) return err.code;
  if (err.parent && typeof err.parent.code === 'string' && err.parent.code in PG_ERROR_CODE_MAP) return err.parent.code;
  if (err.original && typeof err.original.code === 'string' && err.original.code in PG_ERROR_CODE_MAP) return err.original.code;
  return undefined;
}
