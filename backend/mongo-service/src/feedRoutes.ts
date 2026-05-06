import { Router } from 'express';
import type { Request, Response } from 'express';
import { UserFeedEntry } from './models/UserFeedEntry.js';

const router = Router();

router.get('/:userId', async (req: Request, res: Response): Promise<any> => {
  const userIdParam = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  if (!userIdParam) {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'MISSING_USER_ID',
      details: 'Brak parametru userId.'
    });
  }

  const userId = parseInt(userIdParam, 10);
  if (Number.isNaN(userId)) {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'INVALID_USER_ID',
      details: 'Nieprawidlowy userId.'
    });
  }

  const limit = parseInt(req.query.limit as string) || 10;
  const cursor = req.query.cursor as string; // Oczekujemy np. daty ISO lub ObjectId

  if (cursor) {
    const parsedCursor = new Date(cursor);
    if (Number.isNaN(parsedCursor.getTime())) {
      return res.status(400).json({
        error: 'Validation Error',
        code: 'INVALID_CURSOR',
        details: 'Nieprawidlowy format kursora.'
      });
    }
  }

  try {
    // Podstawowe zapytanie - szukamy wpisów dla konkretnego usera
    const query: any = { userId };

    // Jeśli podano kursor, szukamy wpisów starszych niż kursor
    if (cursor) {
      query.insertedAt = { $lt: new Date(cursor) };
    }

    const feed = await UserFeedEntry.find(query)
      .sort({ insertedAt: -1 }) // Od najnowszych
      .limit(limit)
      .populate({
        path: 'richPost',
        select: { postId: 1, attachments: 1, poll: 1, updatedAt: 1 }
      })
      .lean(); // .lean() dla wydajności (zwraca czysty JSON, nie pełne dokumenty Mongoose)

    // Wyznaczamy nowy kursor dla następnej strony (data ostatniego elementu)
    const nextCursor = feed.length > 0 ? feed[feed.length - 1]?.insertedAt ?? null : null;

    return res.json({
      data: feed,
      nextCursor
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      error: 'Internal Server Error',
      code: 'FEED_QUERY_FAILED',
      details: message
    });
  }
});

export default router;