import type { Request, Response, NextFunction } from 'express';
import pgPool from '../config/pgPool.js';

// T1: endpoint na natywnym sterowniku pg.
export async function userStats(req: Request, res: Response, next: NextFunction) {
  const idParam = req.params.id;
  const userId = parseInt(String(idParam ?? ''), 10);
  if (Number.isNaN(userId)) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_USER_ID', details: 'User ID must be a valid integer.' });
  }

  try {
    const userResult = await pgPool.query<{ id: number; username: string; email: string; created_at: Date }>(
      'SELECT id, username, email, "createdAt" AS created_at FROM "User" WHERE id = $1',
      [userId]
    );

    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: 'Not Found', code: 'USER_NOT_FOUND', details: `Użytkownik o ID ${userId} nie istnieje.` });
    }

    const statsResult = await pgPool.query<{
      posts_count: string;
      followers_count: string;
      following_count: string;
      reactions_received: string;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM "Post" WHERE "authorId" = $1) AS posts_count,
         (SELECT COUNT(*)::int FROM "Follow" WHERE "followeeId" = $1) AS followers_count,
         (SELECT COUNT(*)::int FROM "Follow" WHERE "followerId" = $1) AS following_count,
         (SELECT COUNT(*)::int FROM "Reaction" r
            JOIN "Post" p ON p.id = r."postId" WHERE p."authorId" = $1) AS reactions_received`,
      [userId]
    );

    const stats = statsResult.rows[0];

    res.json({
      user: userResult.rows[0],
      stats: {
        postsCount: Number(stats?.posts_count ?? 0),
        followersCount: Number(stats?.followers_count ?? 0),
        followingCount: Number(stats?.following_count ?? 0),
        reactionsReceived: Number(stats?.reactions_received ?? 0),
      },
    });
  } catch (error) {
    next(error);
  }
}

// T1: drugi endpoint pokazujący użycie $1 + $2.
export async function topPosts(req: Request, res: Response, next: NextFunction) {
  const limitParam = req.query.limit;
  const sinceParam = req.query.since;
  const limit = Math.min(Math.max(parseInt(String(limitParam ?? '10'), 10) || 10, 1), 100);

  let sinceDate: Date;
  if (typeof sinceParam === 'string' && sinceParam.trim() !== '') {
    const parsed = new Date(sinceParam);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'Validation Error', code: 'INVALID_SINCE', details: 'since musi być prawidłową datą ISO 8601.' });
    }
    sinceDate = parsed;
  } else {
    sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }

  try {
    const result = await pgPool.query<{
      id: number;
      body_preview: string;
      author_id: number;
      reactions_count: string;
      created_at: Date;
    }>(
      `SELECT p.id,
              p."bodyPreview" AS body_preview,
              p."authorId"    AS author_id,
              p."createdAt"   AS created_at,
              COUNT(r.id)::int AS reactions_count
       FROM "Post" p
       LEFT JOIN "Reaction" r ON r."postId" = p.id
       WHERE p."createdAt" >= $1
       GROUP BY p.id
       ORDER BY reactions_count DESC, p."createdAt" DESC
       LIMIT $2`,
      [sinceDate, limit]
    );

    res.json({
      since: sinceDate.toISOString(),
      limit,
      posts: result.rows.map((row) => ({
        id: row.id,
        bodyPreview: row.body_preview,
        authorId: row.author_id,
        createdAt: row.created_at,
        reactionsCount: Number(row.reactions_count ?? 0),
      })),
    });
  } catch (error) {
    next(error);
  }
}
