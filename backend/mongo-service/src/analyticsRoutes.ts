import { Router } from 'express';
import type { Request, Response } from 'express';
import type { PipelineStage } from 'mongoose';
import { UserFeedEntry } from './models/UserFeedEntry.js';
import { ActivityDaily } from './models/ActivityDaily.js';
import { getNativeDb } from './db.js';

const router = Router();

// Wymóg T5: Zasób domenowy sterownikiem natywnym
router.post('/system-logs', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = getNativeDb();
    if (!db) throw new Error('Native DB client not initialized');
    
    const { level, message, metadata } = req.body;
    const collection = db.collection('system_logs');
    
    const result = await collection.insertOne({
      level: level || 'info',
      message: message || '',
      metadata: metadata || {},
      timestamp: new Date()
    });

    return res.status(201).json({ success: true, id: result.insertedId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Internal Server Error', code: 'LOG_WRITE_FAILED', details: message });
  }
});

router.get('/system-logs', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = getNativeDb();
    if (!db) {
      throw new Error('Native DB client not initialized');
    }
    const collection = db.collection('system_logs');
    // Using 3 different native operators
    const logs = await collection.find({
      level: { $in: ['error', 'warn', 'info'] },
      timestamp: { $gte: new Date(Date.now() - 86400000) } // last 24h
    })
    .sort({ timestamp: -1 })
    .limit(50)
    .toArray();

    return res.json({ logs });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      error: 'Internal Server Error',
      code: 'NATIVE_QUERY_FAILED',
      details: message
    });
  }
});

router.get('/trending', async (req: Request, res: Response): Promise<any> => {
  try {
    // Agregacja analityczna bezpośrednio w bazie (Wymóg T7)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const pipeline: PipelineStage[] = [
      // 1. $match (Wymóg: pierwszy match pod indeks. Tutaj indeks zadziałałby na insertedAt, 
      // gdybyśmy go mieli, ale filtrujemy datę by zmniejszyć zbiór)
      { 
        $match: { insertedAt: { $gte: sevenDaysAgo } } 
      },
      // 2. $group - Grupujemy wpisy feedu po postId, by zobaczyć które posty miały największy fan-out
      {
        $group: {
          _id: "$postId",
          totalReach: { $sum: 1 },
          avgScore: { $avg: "$score" }
        }
      },
      // 3. Dodatkowy stage - $sortowanie po największym zasięgu
      {
        $sort: { totalReach: -1 as const }
      },
      {
        $limit: 10
      },
      // 4. $lookup - Łączymy z kolekcją RichPost (wymóg T7)
      // Uwaga na nazwy kolekcji w Mongo: mongoose domyślnie tworzy małe litery z "s" na końcu
      {
        $lookup: {
          from: "richposts",
          localField: "_id",
          foreignField: "postId",
          as: "richData"
        }
      },
      // 5. $project - Formatyzujemy końcowy wynik, by był czytelny (wymóg T7)
      {
        $project: {
          _id: 0,
          postId: "$_id",
          reach: "$totalReach",
          averageScore: { $round: ["$avgScore", 2] },
          hasPoll: { $gt: [{ $size: { $ifNull: [{ $arrayElemAt: ["$richData.poll.options", 0] }, []] } }, 0] },
          attachmentsCount: { $size: { $ifNull: [{ $arrayElemAt: ["$richData.attachments", 0] }, []] } }
        }
      }
    ];

    const trendingPosts = await UserFeedEntry.aggregate(pipeline);
    
    return res.json({ trending: trendingPosts });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      error: 'Internal Server Error',
      code: 'ANALYTICS_FAILED',
      details: message
    });
  }
});

router.get('/top-authors-weekly', async (req: Request, res: Response): Promise<any> => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setUTCHours(0, 0, 0, 0);

    const pipeline: PipelineStage[] = [
      // 1. $match po indeksie (day)
      {
        $match: {
          day: { $gte: sevenDaysAgo }
        }
      },
      // 2. $group po autorze
      {
        $group: {
          _id: '$authorId',
          totalPosts: { $sum: '$postsCreated' }
        }
      },
      // 3. dodatkowy stage - sortowanie
      {
        $sort: { totalPosts: -1 as const }
      },
      {
        $limit: 10
      },
      // 4. $lookup - powiazanie z rich_posts (pokaz przykladowe dane)
      {
        $lookup: {
          from: 'richposts',
          localField: '_id',
          foreignField: 'authorId',
          as: 'posts'
        }
      },
      // 5. $project - ksztalt odpowiedzi
      {
        $project: {
          _id: 0,
          authorId: '$_id',
          totalPosts: 1,
          samplePostId: { $arrayElemAt: ['$posts.postId', 0] },
          attachmentsCount: {
            $size: { $ifNull: [{ $arrayElemAt: ['$posts.attachments', 0] }, []] }
          }
        }
      }
    ];

    const topAuthors = await ActivityDaily.aggregate(pipeline);
    return res.json({ topAuthors });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      error: 'Internal Server Error',
      code: 'TOP_AUTHORS_FAILED',
      details: message
    });
  }
});

// Wymóg T7: Rozkład reakcji (Pipeline: rozkład reakcji)
router.get('/reaction-distribution', async (req: Request, res: Response): Promise<any> => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const pipeline: PipelineStage[] = [
      // 1. $match po indeksie
      {
        $match: { day: { $gte: sevenDaysAgo } }
      },
      // 2. $project konwertujące typ Map na tablicę klucz/wartość do agregacji
      {
        $project: {
          reactionsArray: { $objectToArray: "$reactionsGiven" }
        }
      },
      // 3. $unwind: Rozbijamy tablicę obiektów
      {
        $unwind: { path: "$reactionsArray", preserveNullAndEmptyArrays: false }
      },
      // 4. $group sumujące całkowitą liczbę reakcji tego samego typu
      {
        $group: {
          _id: "$reactionsArray.k",
          totalCount: { $sum: "$reactionsArray.v" }
        }
      },
      // 5. $sort
      {
        $sort: { totalCount: -1 as const }
      },
      {
        $project: {
          _id: 0,
          reactionType: "$_id",
          totalCount: 1
        }
      }
    ];

    const distribution = await ActivityDaily.aggregate(pipeline);
    return res.json({ distribution });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      error: 'Internal Server Error',
      code: 'REACTION_DISTR_FAILED',
      details: message
    });
  }
});

export default router;