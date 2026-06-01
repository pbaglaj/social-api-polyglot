// T2 - seed domenowy: kanoniczne tagi społeczne.

exports.seed = async function (knex) {
  await knex('post_tags').del();
  await knex('tags').del();

  const tags = [
    { name: 'tech',        description: 'Technologia, programowanie, narzędzia.', usage_count: 0 },
    { name: 'news',        description: 'Wiadomości i wydarzenia.',                usage_count: 0 },
    { name: 'sport',       description: 'Sport, treningi, mecze.',                  usage_count: 0 },
    { name: 'music',       description: 'Muzyka, koncerty, polecanki.',             usage_count: 0 },
    { name: 'travel',      description: 'Podróże i turystyka.',                     usage_count: 0 },
    { name: 'food',        description: 'Jedzenie, przepisy, restauracje.',         usage_count: 0 },
    { name: 'gaming',      description: 'Gry, e-sport, recenzje.',                  usage_count: 0 },
    { name: 'photography', description: 'Fotografia i edycja zdjęć.',               usage_count: 0 },
  ];

  await knex('tags').insert(tags);
};
