// T2 - Addytywna migracja #2: tabela łącząca posty i tagi.
// FK do "Post" (tabela Prismy).

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('post_tags');
  if (exists) return;

  await knex.schema.createTable('post_tags', (table) => {
    table.increments('id').primary();
    table.integer('post_id').notNullable();
    table.integer('tag_id').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['post_id', 'tag_id']);
  });

  await knex.schema.raw(
    `ALTER TABLE post_tags
       ADD CONSTRAINT post_tags_post_id_fkey
       FOREIGN KEY (post_id) REFERENCES "Post"(id) ON DELETE CASCADE`
  );
  await knex.schema.raw(
    `ALTER TABLE post_tags
       ADD CONSTRAINT post_tags_tag_id_fkey
       FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE`
  );

  await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_post_tags_tag_id ON post_tags(tag_id)');
  await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_post_tags_post_id ON post_tags(post_id)');
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('post_tags');
};
