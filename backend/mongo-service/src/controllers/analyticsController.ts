import type { Request, Response } from 'express';
import { UserFeedEntry } from '../models/UserFeedEntry.js';
import { ActivityDaily } from '../models/ActivityDaily.js';
import { getNativeDb } from '../config/index.js';
import { trendingPipeline } from '../aggregations/trendingPipeline.js';
import { topAuthorsWeeklyPipeline } from '../aggregations/topAuthorsWeekly.js';
import { reactionDistributionPipeline } from '../aggregations/reactionDistribution.js';

// T5: zasób domenowy sterownikiem natywnym.
export async function createSystemLog(req: Request, res: Response): Promise<any> {
  try {
    const db = getNativeDb();
    if (!db) throw new Error('Native DB client not initialized');

    const { level, message, metadata } = req.body;
    const collection = db.collection('system_logs');

    const result = await collection.insertOne({
      level: level || 'info',
      message: message || '',
      metadata: metadata || {},
      timestamp: new Date(),
    });

    return res.status(201).json({ success: true, id: result.insertedId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Internal Server Error', code: 'LOG_WRITE_FAILED', details: message });
  }
}

export async function listSystemLogs(_req: Request, res: Response): Promise<any> {
  try {
    const db = getNativeDb();
    if (!db) throw new Error('Native DB client not initialized');
    const collection = db.collection('system_logs');
    // T5: min. 3 rozne operatory ($in, $gte, $exists, $ne -> 4).
    const logs = await collection
      .find({
        level: { $in: ['error', 'warn', 'info'] },
        timestamp: { $gte: new Date(Date.now() - 86400000) },
        message: { $exists: true, $ne: '' },
      })
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();

    return res.json({ logs });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Internal Server Error', code: 'NATIVE_QUERY_FAILED', details: message });
  }
}

export async function trending(_req: Request, res: Response): Promise<any> {
  try {
    const trendingPosts = await UserFeedEntry.aggregate(trendingPipeline(7));
    return res.json({ trending: trendingPosts });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Internal Server Error', code: 'ANALYTICS_FAILED', details: message });
  }
}

export async function topAuthorsWeekly(_req: Request, res: Response): Promise<any> {
  try {
    const topAuthors = await ActivityDaily.aggregate(topAuthorsWeeklyPipeline());
    return res.json({ topAuthors });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Internal Server Error', code: 'TOP_AUTHORS_FAILED', details: message });
  }
}

export async function reactionDistribution(_req: Request, res: Response): Promise<any> {
  try {
    const distribution = await ActivityDaily.aggregate(reactionDistributionPipeline(7));
    return res.json({ distribution });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Internal Server Error', code: 'REACTION_DISTR_FAILED', details: message });
  }
}
