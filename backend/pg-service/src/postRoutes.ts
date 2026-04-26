import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

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

    // Próba zapisu "Rich" danych do MongoDB przez HTTP
    const mongoPayload = {
      postId: createdPost.id,
      authorId: createdPost.authorId,
      attachments: attachments || [],
      poll: poll || undefined
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
      await prisma.post.delete({ where: { id: createdPost.id } }).catch(e => 
        console.error('Krytyczny błąd kompensacji!', e)
      );
    }
    
    // Przekazanie błędu do middleware'u
    next(error); 
  }
});

export default router;