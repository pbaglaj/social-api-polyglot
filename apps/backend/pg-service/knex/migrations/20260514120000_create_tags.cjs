// T2 - Addytywna migracja #1: tabela tagów hashtagowych.
// Nie modyfikuje istniejących tabel zarządzanych przez Prisma.

exports.up = async function (knex) {
  await knex.schema.createTable('tags', (table) => {
    table.increments('id').primary();
    table.string('name', 64).notNullable().unique();
    table.text('description').nullable();
    table.integer('usage_count').notNullable().defaultTo(0);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_tags_usage_count ON tags(usage_count DESC)');
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('tags');
};
