import { Router } from 'express';
import type { Request, Response } from 'express';
import type { PipelineStage } from 'mongoose';
import { UserFeedEntry } from './models/UserFeedEntry.js';

const router = Router();

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

export default router;