import type { PipelineStage } from 'mongoose';

// T7: trending posts - $match (pod indeks), $group, $sort, $lookup, $project.
// Zwraca top 10 postów z największym fan-outem w ostatnich `days` dniach.
export function trendingPipeline(days: number = 7): PipelineStage[] {
  const since = new Date();
  since.setDate(since.getDate() - days);

  return [
    { $match: { insertedAt: { $gte: since } } },
    {
      $group: {
        _id: '$postId',
        totalReach: { $sum: 1 },
        avgScore: { $avg: '$score' },
      },
    },
    { $sort: { totalReach: -1 as const } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'richposts',
        localField: '_id',
        foreignField: 'postId',
        as: 'richData',
      },
    },
    {
      $project: {
        _id: 0,
        postId: '$_id',
        reach: '$totalReach',
        averageScore: { $round: ['$avgScore', 2] },
        hasPoll: { $gt: [{ $size: { $ifNull: [{ $arrayElemAt: ['$richData.poll.options', 0] }, []] } }, 0] },
        attachmentsCount: { $size: { $ifNull: [{ $arrayElemAt: ['$richData.attachments', 0] }, []] } },
      },
    },
  ];
}
