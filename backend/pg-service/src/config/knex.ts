import knexLib, { type Knex } from 'knex';

const globalForKnex = globalThis as unknown as {
  knex?: Knex;
};

function createKnex(): Knex {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Brak zmiennej DATABASE_URL dla Knex.');
  }
  return knexLib({
    client: 'pg',
    connection: connectionString,
    pool: { min: 0, max: Number(process.env.KNEX_POOL_MAX || 10) },
  });
}

// Proxy: leniwe utworzenie instancji Knex.
// Target MUSI być funkcją, żeby `apply`-trap (np. `knex('tags')`) zadziałał.
const knex = new Proxy(
  function () {} as unknown as Knex,
  {
    get(_target, prop) {
      if (!globalForKnex.knex) {
        globalForKnex.knex = createKnex();
      }
      const value: any = (globalForKnex.knex as any)[prop];
      return typeof value === 'function' ? value.bind(globalForKnex.knex) : value;
    },
    apply(_target, _thisArg, args) {
      if (!globalForKnex.knex) {
        globalForKnex.knex = createKnex();
      }
      return (globalForKnex.knex as any)(...args);
    },
  }
) as Knex;

export default knex;
