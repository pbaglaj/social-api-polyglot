import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import prisma from '../config/prisma.js';

export async function listUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const username = typeof req.query.username === 'string' ? req.query.username.trim() : '';
    const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';

    const where: Prisma.UserWhereInput = {};
    if (username) where.username = { contains: username, mode: 'insensitive' };
    if (email) where.email = { contains: email, mode: 'insensitive' };

    const users = await prisma.user.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.status(200).json({ success: true, users });
  } catch (error) {
    next(error);
  }
}

// T17, T18: follow z blokadą self-follow
export async function follow(req: Request, res: Response, next: NextFunction): Promise<void> {
  const followeeParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!followeeParam) {
    res.status(400).json({ error: 'Validation Error', code: 'INVALID_FOLLOWEE_ID', details: 'No followee ID provided.' });
    return;
  }

  const followeeId = parseInt(followeeParam, 10);
  if (Number.isNaN(followeeId)) {
    res.status(400).json({ error: 'Validation Error', code: 'INVALID_FOLLOWEE_ID', details: 'Invalid followee ID.' });
    return;
  }

  const followerIdParam = req.body?.followerId;
  const followerId = typeof followerIdParam === 'string' ? parseInt(followerIdParam, 10) : Number(followerIdParam);

  if (!Number.isInteger(followerId)) {
    res.status(400).json({ error: 'Validation Error', code: 'INVALID_FOLLOWER_ID', details: 'Invalid follower ID.' });
    return;
  }

  if (followerId === followeeId) {
    res.status(400).json({ error: 'Validation Error', code: 'SELF_FOLLOW', details: 'Cannot follow yourself.' });
    return;
  }

  try {
    const existingFollow = await prisma.follow.findUnique({
      where: { followerId_followeeId: { followerId, followeeId } },
    });

    if (existingFollow) {
      res.status(409).json({ error: 'Conflict', code: 'ALREADY_FOLLOWING', details: 'Follow relationship already exists.' });
      return;
    }

    const follow = await prisma.follow.create({ data: { followerId, followeeId } });
    res.status(201).json({ success: true, follow });
    return;
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({ error: 'Conflict', code: 'ALREADY_FOLLOWING', details: 'Follow relationship already exists.' });
      return;
    }
    next(error);
  }
}

export async function unfollow(req: Request, res: Response, next: NextFunction): Promise<void> {
  const followeeParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!followeeParam) {
    res.status(400).json({ error: 'Validation Error', code: 'INVALID_FOLLOWEE_ID', details: 'No followee ID provided.' });
    return;
  }

  const followeeId = parseInt(followeeParam, 10);
  if (Number.isNaN(followeeId)) {
    res.status(400).json({ error: 'Validation Error', code: 'INVALID_FOLLOWEE_ID', details: 'Invalid followee ID.' });
    return;
  }

  const followerIdParam = req.body?.followerId;
  const followerId = typeof followerIdParam === 'string' ? parseInt(followerIdParam, 10) : Number(followerIdParam);

  if (!Number.isInteger(followerId)) {
    res.status(400).json({ error: 'Validation Error', code: 'INVALID_FOLLOWER_ID', details: 'Invalid follower ID.' });
    return;
  }

  try {
    const result = await prisma.follow.deleteMany({ where: { followerId, followeeId } });
    if (result.count === 0) {
      res.status(404).json({ error: 'Not Found', code: 'FOLLOW_NOT_FOUND', details: 'Follow relationship does not exist.' });
      return;
    }
    res.status(204).send();
    return;
  } catch (error) {
    next(error);
  }
}
