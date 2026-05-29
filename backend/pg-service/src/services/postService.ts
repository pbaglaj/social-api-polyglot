import prisma from '../config/prisma.js';
import { notifyFollowersAboutNewPost } from './notificationService.js';
import { invalidatePrefix } from '../middlewares/cache.js';

// Adres serwisu Mongo (wewnątrz sieci Docker)
const MONGO_SERVICE_URL = 'http://mongo-service:3002';

export interface CreatePostInput {
  authorId: number;
  bodyPreview: string;
  attachments?: any[];
  poll?: any;
}

// T8c: hybrydowy zapis z kompensacją.
// PG -> Mongo (rich + fan-out). Jeśli Mongo się wywróci, kasujemy post w PG.
export async function createPostWithFanout(input: CreatePostInput) {
  const { authorId, bodyPreview, attachments, poll } = input;
  let createdPost: any = null;

  try {
    createdPost = await prisma.post.create({
      data: { authorId, bodyPreview },
      include: { author: { select: { username: true } } },
    });

    // Pobieranie ID obserwujących (T19 - fan-out)
    const followers = await prisma.follow.findMany({
      where: { followeeId: authorId },
      select: { followerId: true },
    });
    const followerIds = followers.map((f) => f.followerId);

    const mongoPayload = {
      postId: createdPost.id,
      authorId: createdPost.authorId,
      attachments: attachments || [],
      poll: poll || undefined,
      followerIds,
    };

    const mongoResponse = await fetch(`${MONGO_SERVICE_URL}/api/internal/rich-posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mongoPayload),
    });

    if (!mongoResponse.ok) {
      const mongoError = await mongoResponse.json();
      throw new Error(`Mongo Error: ${JSON.stringify(mongoError)}`);
    }

    // Powiadomienia "new_post" do followers - best-effort, nie zwala posta.
    if (followerIds.length > 0) {
      notifyFollowersAboutNewPost({
        authorId,
        authorUsername: createdPost.author?.username ?? null,
        postId: createdPost.id,
        followerIds,
      }).catch((err) =>
        console.error(`[notifications] Blad fan-out powiadomien dla posta ${createdPost.id}:`, err)
      );
    }

    void invalidatePrefix('posts:list');
    return createdPost;
  } catch (error) {
    // KOMPENSACJA (T10) - rollback w architekturze rozproszonej
    if (createdPost) {
      console.warn(`[Kompensacja] Usuwanie posta ${createdPost.id} z PG z powodu błędu Mongo...`);
      await prisma.post.delete({ where: { id: createdPost.id } }).catch((e: unknown): void =>
        console.error('Krytyczny błąd kompensacji!', e)
      );
    }
    throw error;
  }
}

// T17: idempotentne dodawanie reakcji + fire-and-forget powiadomienie analytics.
export async function upsertReaction(postId: number, userId: number, type: string) {
  const existing = await prisma.reaction.findUnique({
    where: { postId_userId: { postId, userId } },
    select: { type: true },
  });
  const previousType = existing?.type ?? null;

  const reaction = await prisma.reaction.upsert({
    where: { postId_userId: { postId, userId } },
    update: { type },
    create: { postId, userId, type },
  });

  if (previousType !== type) {
    fetch(`${MONGO_SERVICE_URL}/api/internal/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, type, previousType }),
    }).catch((err) => console.error(`Blad notyfikacji reaction analytics (post ${postId}):`, err));
  }

  void invalidatePrefix('posts:list');
  return reaction;
}

// T18: usunięcie postu + kaskada w PG (transakcja) + sygnał HTTP do Mongo.
export async function deletePostCascade(postId: number, requesterId: number) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, authorId: true },
  });

  if (!post) return { status: 'not_found' as const };
  if (post.authorId !== requesterId) return { status: 'forbidden' as const };

  await prisma.$transaction(async (tx) => {
    await tx.comment.deleteMany({ where: { postId } });
    await tx.reaction.deleteMany({ where: { postId } });
    await tx.post.delete({ where: { id: postId } });
  });

  // fire-and-forget - nie blokujemy odpowiedzi błędem Mongo
  fetch(`${MONGO_SERVICE_URL}/api/internal/rich-posts/${postId}`, { method: 'DELETE' })
    .catch((err) => console.error(`Błąd usuwania wpisów feedu dla posta ${postId}:`, err));

  void invalidatePrefix('posts:list');
  void invalidatePrefix('posts:comments');
  return { status: 'deleted' as const };
}
