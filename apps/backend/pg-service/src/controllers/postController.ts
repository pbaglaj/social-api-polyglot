import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { validatePost, validateComment } from '../utils/validators.js';
import { createPostWithFanout, upsertReaction, deletePostCascade } from '../services/postService.js';
import { invalidatePrefix } from '../middlewares/cache.js';

export async function createPost(req: Request, res: Response, next: NextFunction) {
  // Tozsamosc z tokenu (jezeli zalogowany) nadpisuje authorId z body -
  // user moze tworzyc posty tylko we wlasnym imieniu.
  if (req.appUser) req.body = { ...req.body, authorId: req.appUser.id };

  let validatedData;
  try {
    validatedData = validatePost(req.body);
  } catch (error) {
    return next(error);
  }

  try {
    const createdPost = await createPostWithFanout(validatedData);
    res.status(201).json(createdPost);
  } catch (error) {
    next(error);
  }
}

// T17: filtrowanie + (T4) wykorzystanie $queryRaw dla zaawansowanych filtrów.
export async function listPosts(req: Request, res: Response, next: NextFunction) {
  const authorId = req.query.authorId ? parseInt(req.query.authorId as string, 10) : undefined;
  const hashtag = req.query.hashtag as string;

  try {
    let filteredIds: number[] | null = null;

    if (authorId && hashtag) {
      const rawPosts = await prisma.$queryRaw<{ id: number }[]>`SELECT "id" FROM "Post" WHERE "authorId" = ${authorId} AND "bodyPreview" ILIKE ${'%' + hashtag + '%'}`;
      filteredIds = rawPosts.map((p) => p.id);
    } else if (authorId) {
      const rawPosts = await prisma.$queryRaw<{ id: number }[]>`SELECT "id" FROM "Post" WHERE "authorId" = ${authorId}`;
      filteredIds = rawPosts.map((p) => p.id);
    } else if (hashtag) {
      const rawPosts = await prisma.$queryRaw<{ id: number }[]>`SELECT "id" FROM "Post" WHERE "bodyPreview" ILIKE ${'%' + hashtag + '%'}`;
      filteredIds = rawPosts.map((p) => p.id);
    }

    const where: Prisma.PostWhereInput = {};
    if (filteredIds !== null) where.id = { in: filteredIds };

    const posts = await prisma.post.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { username: true } },
        _count: { select: { reactions: true } },
      },
    });

    res.json(posts);
  } catch (error) {
    next(error);
  }
}

export async function addReaction(req: Request, res: Response, next: NextFunction) {
  const idParam = req.params.id;
  if (typeof idParam !== 'string') {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_POST_ID', details: 'Invalid post ID format.' });
  }
  const postId = parseInt(idParam, 10);
  if (isNaN(postId)) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_POST_ID', details: 'Post ID must be a valid number.' });
  }

  const userId = req.appUser ? req.appUser.id : req.body.userId;
  const { type } = req.body;

  try {
    const reaction = await upsertReaction(postId, userId, type);
    res.json(reaction);
  } catch (error) {
    next(error);
  }
}

export async function deletePost(req: Request, res: Response, next: NextFunction) {
  const idParam = req.params.id;
  if (typeof idParam !== 'string') {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_POST_ID', details: 'Invalid post ID format.' });
  }
  const postId = parseInt(idParam, 10);
  if (isNaN(postId)) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_POST_ID', details: 'Post ID must be a valid number.' });
  }

  // Wlasciciel posta z tokenu; Admin/Moderator moze kasowac dowolny post.
  const privileged = (req.roles ?? []).some((r) => r === 'Admin' || r === 'Moderator');
  const requesterIdRaw = req.appUser ? req.appUser.id : (req.body?.requesterId ?? req.body?.userId ?? req.body?.authorId ?? req.body?.followerId);
  const requesterId = typeof requesterIdRaw === 'string' ? parseInt(requesterIdRaw, 10) : Number(requesterIdRaw);
  if (!Number.isInteger(requesterId)) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_REQUESTER_ID', details: 'Requester ID must be a valid number.' });
  }

  try {
    const result = await deletePostCascade(postId, requesterId, privileged);
    if (result.status === 'not_found') {
      return res.status(404).json({ error: 'Not Found', code: 'POST_NOT_FOUND', details: 'Post not found.' });
    }
    if (result.status === 'forbidden') {
      return res.status(403).json({ error: 'Forbidden', code: 'NOT_POST_OWNER', details: 'Only the post owner can delete this post.' });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

// T15: komentarze z wątkiem (parent_id)
export async function createComment(req: Request, res: Response, next: NextFunction) {
  const idParam = req.params.id;
  if (typeof idParam !== 'string') {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_POST_ID', details: 'Invalid post ID format.' });
  }
  const postId = parseInt(idParam, 10);
  if (isNaN(postId)) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_POST_ID', details: 'Post ID must be a valid number.' });
  }

  let validatedComment;
  try {
    validatedComment = validateComment(req.body);
  } catch (error) {
    return next(error);
  }

  const { content, parentId } = validatedComment;
  const authorId = req.appUser ? req.appUser.id : validatedComment.authorId;

  try {
    const comment = await prisma.comment.create({
      data: {
        postId,
        authorId: Number(authorId),
        content,
        parentId: parentId ? Number(parentId) : null,
      },
    });
    void invalidatePrefix('posts:comments');
    res.status(201).json(comment);
  } catch (error) {
    next(error);
  }
}

export async function listComments(req: Request, res: Response, next: NextFunction) {
  const idParam = req.params.id;
  if (typeof idParam !== 'string') {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_POST_ID', details: 'Invalid post ID format.' });
  }
  const postId = parseInt(idParam, 10);
  if (isNaN(postId)) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_POST_ID', details: 'Post ID must be a valid number.' });
  }

  try {
    const comments = await prisma.comment.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { username: true } }, replies: true },
    });
    res.json(comments);
  } catch (error) {
    next(error);
  }
}
