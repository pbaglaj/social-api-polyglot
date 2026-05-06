import  { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import prisma from './db.js';

const router = Router();

// Adres serwisu Mongo (wewnątrz sieci Docker)
const MONGO_SERVICE_URL = 'http://mongo-service:3002';

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const { authorId, bodyPreview, attachments, poll } = req.body;

  // Podstawowa walidacja (Wymóg T18: limit długości)
  if (!bodyPreview || bodyPreview.length > 255) {
    return next({ name: 'ValidationError', message: 'Treść musi mieć od 1 do 255 znaków.' });
  }

  let createdPost;

  try {
    // Zapis do PostgreSQL
    createdPost = await prisma.post.create({
      data: { authorId, bodyPreview },
      // Eager loading w odpowiedzi (Wymóg T3: include)
      include: { author: { select: { username: true } } } 
    });

    // Pobieranie ID obserwujących (Wymóg T19 - do fan-outu)
    const followers = await prisma.follow.findMany({
      where: { followeeId: authorId },
      select: { followerId: true }
    });
    const followerIds = (followers as Array<{ followerId: number }>).map(
      (f: { followerId: number }) => f.followerId
    );

    // Próba zapisu "Rich" danych do MongoDB przez HTTP
    const mongoPayload = {
      postId: createdPost.id,
      authorId: createdPost.authorId,
      attachments: attachments || [],
      poll: poll || undefined,
      followerIds // Przekazujemy listę obserwujących do operacji fan-outu w Mongo
    };

    const mongoResponse = await fetch(`${MONGO_SERVICE_URL}/api/internal/rich-posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mongoPayload)
    });

    if (!mongoResponse.ok) {
      const mongoError = await mongoResponse.json();
      throw new Error(`Mongo Error: ${JSON.stringify(mongoError)}`);
    }

    res.status(201).json(createdPost);

  } catch (error) {
    // KOMPENSACJA (Rollback w architekturze rozproszonej - Wymóg T10)
    if (createdPost) {
      console.warn(`[Kompensacja] Usuwanie posta ${createdPost.id} z PG z powodu błędu Mongo...`);
      await prisma.post.delete({ where: { id: createdPost.id } }).catch((e: unknown): void => 
        console.error('Krytyczny błąd kompensacji!', e)
      );
    }
    
    // Przekazanie błędu do middleware'u
    next(error); 
  }
});

// [...] (tutaj jest Twój dotychczasowy router.post('/'))

// Wymóg T17: Pobieranie postów z filtrem (np. po ID autora)
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const authorId = req.query.authorId ? parseInt(req.query.authorId as string, 10) : undefined;
  // Wymóg T4: Użycie surowego SQL ($queryRaw) jako alternatywy dla zaawansowanych filtrów
  try {
    if (authorId) {
      // Dynamiczne zapytanie raw (Wymóg T2: bez sklejania stringów, bezpieczne parametryzowanie $1)
      const posts = await prisma.$queryRaw`SELECT * FROM "Post" WHERE "authorId" = ${authorId} ORDER BY "createdAt" DESC`;
      return res.json(posts);
    }
    
    // Zwykłe zapytanie Prisma
    const posts = await prisma.post.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(posts);
  } catch (error) { next(error); }
});

// Wymóg T17: Idempotentne dodawanie reakcji
router.post('/:id/reactions', async (req: Request, res: Response, next: NextFunction) => {
  const idParam = req.params.id;

  if (typeof idParam !== 'string') {
    return res.status(400).json({ error: 'Invalid ID format' });
  }

  const postId = parseInt(idParam, 10);
  if (isNaN(postId)) {
    return res.status(400).json({ error: 'ID must be a valid number' });
  }

  const { userId, type } = req.body;

  try {
    // upsert gwarantuje idempotentność - jeśli istnieje, zaktualizuje, jeśli nie - stworzy.
    const reaction = await prisma.reaction.upsert({
      where: { postId_userId: { postId, userId } },
      update: { type },
      create: { postId, userId, type }
    });
    res.json(reaction);
  } catch (error) { next(error); }
});

// Wymóg T18: Usunięcie postu + usunięcie kaskadowe z Mongo (sygnał HTTP)
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  const idParam = req.params.id;

  if (typeof idParam !== 'string') {
    return res.status(400).json({ error: 'Invalid ID format' });
  }

  const postId = parseInt(idParam, 10);
  if (isNaN(postId)) {
    return res.status(400).json({ error: 'ID must be a valid number' });
  }

  try {
    // Najpierw usuń zależne rekordy (komentarze, reakcje), potem post.
    // Używamy sekwencyjnej transakcji (callback), żeby zagwarantować kolejność operacji.
    await prisma.$transaction(async (tx: any) => {
      await tx.comment.deleteMany({ where: { postId } });
      await tx.reaction.deleteMany({ where: { postId } });
      await tx.post.delete({ where: { id: postId } });
    });

    // "Job" do usunięcia z feedu - wysyłamy żądanie w tle, nie blokujemy odpowiedzi (fire and forget)
    fetch(`${MONGO_SERVICE_URL}/api/internal/rich-posts/${postId}`, { method: 'DELETE' })
      .catch(err => console.error(`Błąd usuwania wpisów feedu dla posta ${postId}:`, err));

    res.status(204).send();
  } catch (error) { next(error); }
});

export default router;