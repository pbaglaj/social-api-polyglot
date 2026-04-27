import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Wymóg T17 i T18: Follow / Unfollow z blokadą self-follow
router.post('/:id/follow', async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const followeeParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!followeeParam) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_FOLLOWEE_ID', details: 'Brak id użytkownika.' });
  }

  const followeeId = parseInt(followeeParam, 10);
  if (Number.isNaN(followeeId)) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_FOLLOWEE_ID', details: 'Nieprawidłowe id użytkownika.' });
  }

  const { followerId } = req.body; // W prawdziwej aplikacji to ID pochodziłoby z tokena JWT

  // Wymóg T18: Blokada self-follow
  if (followerId === followeeId) {
    return res.status(400).json({ 
      error: 'Validation Error', 
      code: 'SELF_FOLLOW', 
      details: 'Nie można obserwować samego siebie.' 
    });
  }

  try {
    const follow = await prisma.follow.create({
      data: { followerId, followeeId }
    });
    return res.status(201).json({ success: true, follow });
  } catch (error) {
    // Jeśli rekord już istnieje, nasz errorHandler złapie błąd P2002 i zwróci 409 Conflict
    next(error); 
  }
});

router.delete('/:id/follow', async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const followeeParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!followeeParam) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_FOLLOWEE_ID', details: 'Brak id użytkownika.' });
  }

  const followeeId = parseInt(followeeParam, 10);
  if (Number.isNaN(followeeId)) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_FOLLOWEE_ID', details: 'Nieprawidłowe id użytkownika.' });
  }

  const { followerId } = req.body;

  try {
    // Usuwamy relację (Unfollow)
    await prisma.follow.delete({
      where: { followerId_followeeId: { followerId, followeeId } }
    });
    return res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;