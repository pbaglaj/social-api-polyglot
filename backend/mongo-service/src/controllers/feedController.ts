import type { Request, Response } from 'express';
import { UserFeedEntry } from '../models/UserFeedEntry.js';

export async function getFeed(req: Request, res: Response): Promise<any> {
  const userIdParam = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  if (!userIdParam) {
    return res.status(400).json({ error: 'Validation Error', code: 'MISSING_USER_ID', details: 'Brak parametru userId.' });
  }

  const userId = parseInt(userIdParam, 10);
  if (Number.isNaN(userId)) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_USER_ID', details: 'Nieprawidlowy userId.' });
  }

  const limit = parseInt(req.query.limit as string) || 10;
  const cursor = req.query.cursor as string;

  if (cursor) {
    const parsedCursor = new Date(cursor);
    if (Number.isNaN(parsedCursor.getTime())) {
      return res.status(400).json({ error: 'Validation Error', code: 'INVALID_CURSOR', details: 'Nieprawidlowy format kursora.' });
    }
  }

  try {
    const query: any = { userId };
    if (cursor) query.insertedAt = { $lt: new Date(cursor) };

    const feed = await UserFeedEntry.find(query)
      .sort({ insertedAt: -1 })
      .limit(limit)
      .populate({
        path: 'richPost',
        select: { postId: 1, attachments: 1, poll: 1, updatedAt: 1 },
      })
      .lean();

    const nextCursor = feed.length > 0 ? feed[feed.length - 1]?.insertedAt ?? null : null;

    return res.json({ data: feed, nextCursor });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Internal Server Error', code: 'FEED_QUERY_FAILED', details: message });
  }
}
