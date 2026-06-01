import { RichPost } from '../models/RichPost.js';
import { UserFeedEntry } from '../models/UserFeedEntry.js';
import { ActivityDaily } from '../models/ActivityDaily.js';

export interface RichPostInput {
  postId: number;
  authorId: number;
  attachments?: any;
  poll?: any;
  followerIds?: number[];
}

// T16 + T19: zapisz rich post, zinkrementuj dzienną aktywność, fan-out do feedu followersów.
export async function createRichPostWithFanout(input: RichPostInput): Promise<void> {
  const { postId, authorId, attachments, poll, followerIds } = input;

  await RichPost.create({ postId, authorId, attachments, poll } as any);

  // Agregacja dzienna aktywności autora.
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);

  await ActivityDaily.updateOne(
    { day, authorId },
    { $inc: { postsCreated: 1 }, $set: { updatedAt: new Date() } },
    { upsert: true }
  );

  // FAN-OUT (T19): masowy insert wpisów do feedu obserwujących.
  if (followerIds && Array.isArray(followerIds) && followerIds.length > 0) {
    const feedEntries = followerIds.map((userId: number) => ({
      userId,
      postId,
      score: 1,
    }));
    await UserFeedEntry.insertMany(feedEntries);
  }
}

// Wywoływane z pg-service po każdej operacji upsert na Reaction.
export async function updateReactionsDistribution(
  userId: number,
  type: string,
  previousType?: string | null
): Promise<void> {
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
}

// T18: kaskadowe usuwanie rich post + wpisów feedu.
export async function cascadeDeleteRichPost(postId: number): Promise<void> {
  await RichPost.deleteOne({ postId });
  await UserFeedEntry.deleteMany({ postId });
}
