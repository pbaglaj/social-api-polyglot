import type { PipelineStage } from 'mongoose';

// T7: reaction distribution - $match, $project (Map -> array), $unwind, $group, $sort, $project.
// Rozbija pole `reactionsGiven` (Map<type, count>) na pary i sumuje globalnie.
export function reactionDistributionPipeline(days: number = 7): PipelineStage[] {
  const since = new Date();
  since.setDate(since.getDate() - days);

  return [
    { $match: { day: { $gte: since } } },
    {
      $project: {
        reactionsArray: { $objectToArray: '$reactionsGiven' },
      },
    },
    { $unwind: { path: '$reactionsArray', preserveNullAndEmptyArrays: false } },
    {
      $group: {
        _id: '$reactionsArray.k',
        totalCount: { $sum: '$reactionsArray.v' },
      },
    },
    { $sort: { totalCount: -1 as const } },
    {
      $project: {
        _id: 0,
        reactionType: '$_id',
        totalCount: 1,
      },
    },
  ];
}
