import { Router } from 'express';
import type { Request, Response } from 'express';
import { RichPost } from './models/RichPost.js';
import { UserFeedEntry } from './models/UserFeedEntry.js';

const router = Router();

router.post('/rich-posts', async (req: Request, res: Response): Promise<any> => {
  const { postId, attachments, poll, followerIds } = req.body;

  try {
    // Zapis rozszerzonych danych posta (Wymóg T16)
    await RichPost.create({ postId, attachments, poll });

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
    console.error('Błąd zapisu w Mongo:', error);
    // W przypadku błędu zwracamy 500, co wyzwoli kompensację w PostgreSQL
    return res.status(500).json({ error: 'Błąd wewnętrzny bazy MongoDB', details: error });
  }
});

export default router;