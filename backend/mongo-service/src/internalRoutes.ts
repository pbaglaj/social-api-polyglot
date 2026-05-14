import { Router } from 'express';
import type { Request, Response } from 'express';
import { RichPost } from './models/RichPost.js';
import { UserFeedEntry } from './models/UserFeedEntry.js';
import { ActivityDaily } from './models/ActivityDaily.js';

const router = Router();

router.post('/rich-posts', async (req: Request, res: Response): Promise<any> => {
  const { postId, authorId, attachments, poll, followerIds } = req.body;

  try {
    // Zapis rozszerzonych danych posta (Wymóg T16)
    await RichPost.create({ postId, authorId, attachments, poll });

    // Agregacja dzienna aktywnosci autora (activity_daily)
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);

    await ActivityDaily.updateOne(
      { day, authorId },
      { $inc: { postsCreated: 1 }, $set: { updatedAt: new Date() } },
      { upsert: true }
    );

    // Operacja FAN-OUT (Wymóg T19) - "Rozsiewanie" wpisów do obserwujących
    if (followerIds && Array.isArray(followerIds) && followerIds.length > 0) {
      const feedEntries = followerIds.map((userId: number) => ({
        userId,
        postId,
        score: 1 // Bazowy wynik
      }));
      
      // Masowy insert do MongoDB (bardzo wydajne)
      await UserFeedEntry.insertMany(feedEntries);
    }

    return res.status(201).json({ success: true, message: 'RichPost i Feed utworzone.' });
  } catch (error) {
    console.error('Blad zapisu w Mongo:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    // W przypadku błędu zwracamy 500, co wyzwoli kompensację w PostgreSQL
    return res.status(500).json({
      error: 'Internal Server Error',
      code: 'MONGO_WRITE_FAILED',
      details: message
    });
  }
});

// Aktualizacja mapy reactionsGiven w ActivityDaily — wywolywane z pg-service
// po kazdej operacji upsert na Reaction. Pozwala endpointowi /analytics/reaction-distribution
// zwracac realne dane (wczesniej pole bylo wiecznie puste).
router.post('/reactions', async (req: Request, res: Response): Promise<any> => {
  const { userId, type, previousType } = req.body;

  if (typeof userId !== 'number' || !Number.isInteger(userId)) {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'INVALID_USER_ID',
      details: 'userId musi byc liczba calkowita.'
    });
  }

  if (typeof type !== 'string' || !type.trim()) {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'INVALID_TYPE',
      details: 'type musi byc niepustym stringiem.'
    });
  }

  try {
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);

    const inc: Record<string, number> = { [`reactionsGiven.${type}`]: 1 };
    if (typeof previousType === 'string' && previousType.trim() && previousType !== type) {
      inc[`reactionsGiven.${previousType}`] = -1;
    }

    await ActivityDaily.updateOne(
      { day, authorId: userId },
      { $inc: inc, $set: { updatedAt: new Date() } },
      { upsert: true }
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Blad aktualizacji ActivityDaily.reactionsGiven:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      error: 'Internal Server Error',
      code: 'REACTION_UPDATE_FAILED',
      details: message
    });
  }
});

// Wymóg T18: Kaskadowe usuwanie wpisów z feedu i rich posts
router.delete('/rich-posts/:postId', async (req: Request, res: Response): Promise<any> => {
  const postIdParam = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;
  if (!postIdParam) {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'MISSING_POST_ID',
      details: 'Brak postId.'
    });
  }

  const postId = parseInt(postIdParam, 10);
  if (Number.isNaN(postId)) {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'INVALID_POST_ID',
      details: 'Nieprawidlowy postId.'
    });
  }

  try {
    await RichPost.deleteOne({ postId });
    await UserFeedEntry.deleteMany({ postId }); // Wyczyszczenie feedu ze śmieci
    return res.status(204).send();
  } catch (error) {
    console.error('Blad kaskadowego usuwania w Mongo:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      error: 'Internal Server Error',
      code: 'MONGO_DELETE_FAILED',
      details: message
    });
  }
});

export default router;