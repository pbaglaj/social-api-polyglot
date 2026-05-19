import type { PipelineStage } from 'mongoose';

// T7: top authors weekly - $match po indeksie day, $group, $sort, $lookup, $project.
export function topAuthorsWeeklyPipeline(): PipelineStage[] {
  const since = new Date();
  since.setDate(since.getDate() - 7);
  since.setUTCHours(0, 0, 0, 0);

  return [
    { $match: { day: { $gte: since } } },
    {
      $group: {
        _id: '$authorId',
        totalPosts: { $sum: '$postsCreated' },
      },
    },
    { $sort: { totalPosts: -1 as const } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'richposts',
        localField: '_id',
        foreignField: 'authorId',
        as: 'posts',
      },
    },
    {
      $project: {
        _id: 0,
        authorId: '$_id',
        totalPosts: 1,
        samplePostId: { $arrayElemAt: ['$posts.postId', 0] },
        attachmentsCount: {
          $size: { $ifNull: [{ $arrayElemAt: ['$posts.attachments', 0] }, []] },
        },
      },
    },
  ];
}
