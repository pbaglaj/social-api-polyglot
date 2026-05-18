import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import knex from './knex.js';

const router = Router();

// T2 - endpoint z dynamicznym WHERE budowanym przez Query Builder Knexa.
// Żadnych konkatenacji stringów - same `.where()`, `.andWhere()`, bindings.
// Filtruje: name (ILIKE), minUsage (>=), createdBefore (<).
// Sortowanie: usage_count|name, kierunek asc|desc.
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  const minUsage = req.query.minUsage ? Number(req.query.minUsage) : null;
  const createdBefore = typeof req.query.createdBefore === 'string' ? req.query.createdBefore : '';
  const sortBy = req.query.sortBy === 'name' ? 'name' : 'usage_count';
  const order = req.query.order === 'asc' ? 'asc' : 'desc';
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 100);

  // Walidacja PRZED budową zapytania Knex.
  let before: Date | null = null;
  if (createdBefore) {
    const parsed = new Date(createdBefore);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({
        error: 'Validation Error',
        code: 'INVALID_DATE',
        details: 'createdBefore musi być prawidłową datą ISO 8601.'
      });
    }
    before = parsed;
  }

  try {
    const query = knex('tags').select(
      'id',
      'name',
      'description',
      'usage_count as usageCount',
      'created_at as createdAt'
    );

    if (name) query.whereILike('name', `%${name}%`);
    if (minUsage !== null && !Number.isNaN(minUsage)) query.andWhere('usage_count', '>=', minUsage);
    if (before) query.andWhere('created_at', '<', before);

    query.orderBy(sortBy, order).limit(limit);

    const rows = await query;
    res.json({ count: rows.length, tags: rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/tags - utworzenie nowego tagu (parametry powiązane przez Knex bindings).
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const { name, description } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'INVALID_TAG_NAME',
      details: 'name musi być niepustym stringiem.'
    });
  }
  if (name.length > 64) {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'TAG_NAME_TOO_LONG',
      details: 'name musi mieć maksymalnie 64 znaki.'
    });
  }

  try {
    const [created] = await knex('tags')
      .insert({ name: name.trim().toLowerCase(), description: description ?? null })
      .returning(['id', 'name', 'description', 'usage_count as usageCount', 'created_at as createdAt']);
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

// POST /api/tags/attach - przypisanie tagu do posta.
// Inkrementuje licznik tagu w transakcji Knex.
router.post('/attach', async (req: Request, res: Response, next: NextFunction) => {
  const { postId, tagName } = req.body || {};
  const pid = Number(postId);
  if (!Number.isInteger(pid)) {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'INVALID_POST_ID',
      details: 'postId musi być liczbą całkowitą.'
    });
  }
  if (typeof tagName !== 'string' || !tagName.trim()) {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'INVALID_TAG_NAME',
      details: 'tagName musi być niepustym stringiem.'
    });
  }

  try {
    const result = await knex.transaction(async (trx) => {
      const normalized = tagName.trim().toLowerCase();
      let tag = await trx('tags').where({ name: normalized }).first();
      if (!tag) {
        const [created] = await trx('tags').insert({ name: normalized }).returning(['id', 'name']);
        tag = created;
      }

      await trx('post_tags')
        .insert({ post_id: pid, tag_id: tag!.id })
        .onConflict(['post_id', 'tag_id'])
        .ignore();

      await trx('tags').where({ id: tag!.id }).increment('usage_count', 1);

      return { postId: pid, tag };
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

// GET /api/tags/:name/posts - posty z danym tagiem (JOIN przez Knex).
router.get('/:name/posts', async (req: Request, res: Response, next: NextFunction) => {
  const nameParam = req.params.name;
  if (typeof nameParam !== 'string' || !nameParam.trim()) {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'INVALID_TAG_NAME',
      details: 'name musi być niepustym stringiem.'
    });
  }

  try {
    const rows = await knex('post_tags as pt')
      .join('tags as t', 't.id', 'pt.tag_id')
      .join({ p: 'Post' }, 'p.id', 'pt.post_id')
      .select(
        'p.id',
        'p.bodyPreview as bodyPreview',
        'p.authorId as authorId',
        'p.createdAt as createdAt',
        't.name as tag'
      )
      .where('t.name', nameParam.trim().toLowerCase())
      .orderBy('p.createdAt', 'desc')
      .limit(50);

    res.json({ tag: nameParam.trim().toLowerCase(), count: rows.length, posts: rows });
  } catch (error) {
    next(error);
  }
});

export default router;
