import mongoose from 'mongoose';
import { connectMongoose, disconnectMongoose } from './config/mongoose.js';
import { RichPost } from './models/RichPost.js';
import { UserFeedEntry } from './models/UserFeedEntry.js';

// Seed feedu/rich post dla testowania paginacji w Postmanie.
// Glowny tester: userId = 1 (sporo wpisow, latwo paginowac)
// Pomocniczy:   userId = 2 (mniej wpisow, do roznicowania)
//
// Posty maja postId od 1001 wzwyz, zeby nie kolidowac z autoincrementem pg-service.
const FEED_RECEIVERS: Array<{ userId: number; entries: number }> = [
  { userId: 1, entries: 30 }, // glowny tester
  { userId: 2, entries: 8 },  // mniejszy zestaw
];

// Rozne timestampy zeby cursor mial co odcinac.
// Pierwszy post = teraz, kazdy nastepny -3h wstecz.
function buildInsertedAt(index: number): Date {
  const STEP_HOURS = 3;
  const d = new Date();
  d.setHours(d.getHours() - index * STEP_HOURS);
  return d;
}

const ATTACHMENT_POOL = [
  { url: 'https://cdn.example.com/img-a.png', type: 'image' as const },
  { url: 'https://cdn.example.com/clip-b.mp4', type: 'video' as const },
  { url: 'https://news.example.com/article', type: 'link' as const },
];

async function seedFeed(): Promise<void> {
  const totalEntries = FEED_RECEIVERS.reduce((sum, r) => sum + r.entries, 0);
  const totalPosts = Math.max(...FEED_RECEIVERS.map((r) => r.entries));

  console.log(`[mongo-seed] Czyszczenie istniejacych RichPost/UserFeedEntry dla seedowanych id...`);
  const seededPostIds = Array.from({ length: totalPosts }, (_, i) => 1001 + i);
  const seededUserIds = FEED_RECEIVERS.map((r) => r.userId);
  await RichPost.deleteMany({ postId: { $in: seededPostIds } });
  await UserFeedEntry.deleteMany({ userId: { $in: seededUserIds } });

  console.log(`[mongo-seed] Tworzenie ${totalPosts} RichPost (postId 1001..${1000 + totalPosts})...`);
  const richPostDocs = seededPostIds.map((postId, i) => {
    const attachment = ATTACHMENT_POOL[i % ATTACHMENT_POOL.length]!;
    const base: Record<string, unknown> = {
      postId,
      // authorId rotuje wsrod 2..6, zeby uzytkownik 1 widzial cudze posty
      authorId: 2 + (i % 5),
      attachments: i % 3 === 0 ? [attachment] : [],
    };
    if (i % 5 === 0) {
      base['poll'] = { question: `Ankieta nr ${i}?`, options: ['Tak', 'Nie', 'Moze'] };
    }
    return base;
  });
  await RichPost.insertMany(richPostDocs as any);

  console.log(`[mongo-seed] Tworzenie ${totalEntries} UserFeedEntry...`);
  const feedDocs: Array<{ userId: number; postId: number; score: number; insertedAt: Date }> = [];
  for (const receiver of FEED_RECEIVERS) {
    for (let i = 0; i < receiver.entries; i++) {
      feedDocs.push({
        userId: receiver.userId,
        postId: 1001 + i,
        score: 1 + (i % 100),
        insertedAt: buildInsertedAt(i),
      });
    }
  }
  await UserFeedEntry.insertMany(feedDocs);

  console.log(`[mongo-seed] Gotowe. Przyklady do testow w Postmanie:`);
  console.log(`  GET {{baseUrl}}/api/feed/1                                   -> domyslny limit (10)`);
  console.log(`  GET {{baseUrl}}/api/feed/1?limit=5                           -> pierwsza strona, 5 wpisow`);
  console.log(`  GET {{baseUrl}}/api/feed/1?limit=5&cursor={{nextCursor}}     -> kolejna strona`);
  console.log(`  GET {{baseUrl}}/api/feed/2?limit=3                           -> mniejszy zestaw (8 wpisow lacznie)`);
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI || 'mongodb://mongo:secret@localhost:27017/feed_db?authSource=admin';
  await connectMongoose(uri);
  try {
    await seedFeed();
  } finally {
    await disconnectMongoose();
    // wymuszony exit - mongoose czasem trzyma timery
    if (mongoose.connection.readyState === 0) {
      process.exit(0);
    }
  }
}

main().catch((err) => {
  console.error('[mongo-seed] Blad seedowania:', err);
  process.exit(1);
});
