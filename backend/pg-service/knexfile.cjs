// Knex CLI nie potrzebuje TS — używamy plain CommonJS, aby uniknąć dependency
// na ts-node/sucrase. Migracje i seedy także w .cjs.

const databaseUrl = process.env.DATABASE_URL;

const base = {
  client: 'pg',
  connection: databaseUrl,
  migrations: {
    directory: './knex/migrations',
    extension: 'cjs',
    loadExtensions: ['.cjs', '.js'],
  },
  seeds: {
    directory: './knex/seeds',
    extension: 'cjs',
    loadExtensions: ['.cjs', '.js'],
  },
};

module.exports = {
  development: base,
  production: base,
  test: base,
};
