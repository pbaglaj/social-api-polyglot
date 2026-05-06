import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import prisma from './db.js';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const username = typeof req.query.username === 'string' ? req.query.username.trim() : '';
    const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';

    const where: any = {};

    if (username) {
      where.username = {
        contains: username,
        mode: 'insensitive',
      };
    }

    if (email) {
      where.email = {
        contains: email,
        mode: 'insensitive',
      };
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({ success: true, users });
  } catch (error) {
    next(error);
  }
});

// Wymóg T17 i T18: Follow / Unfollow z blokadą self-follow
router.post('/:id/follow', async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const followeeParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!followeeParam) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_FOLLOWEE_ID', details: 'No followee ID provided.' });
  }

  const followeeId = parseInt(followeeParam, 10);
  if (Number.isNaN(followeeId)) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_FOLLOWEE_ID', details: 'Invalid followee ID.' });
  }

  const { followerId } = req.body; // W prawdziwej aplikacji to ID pochodziłoby z tokena JWT

  // Wymóg T18: Blokada self-follow
  if (followerId === followeeId) {
    return res.status(400).json({ 
      error: 'Validation Error', 
      code: 'SELF_FOLLOW', 
      details: 'Cannot follow yourself.' 
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
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_FOLLOWEE_ID', details: 'No followee ID provided.' });
  }

  const followeeId = parseInt(followeeParam, 10);
  if (Number.isNaN(followeeId)) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_FOLLOWEE_ID', details: 'Invalid followee ID.' });
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