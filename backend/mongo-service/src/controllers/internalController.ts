import type { Request, Response } from 'express';
import {
  createRichPostWithFanout,
  updateReactionsDistribution,
  cascadeDeleteRichPost,
} from '../services/feedService.js';

export async function postRichPost(req: Request, res: Response): Promise<any> {
  const { postId, authorId, attachments, poll, followerIds } = req.body;

  try {
    await createRichPostWithFanout({ postId, authorId, attachments, poll, followerIds });
    return res.status(201).json({ success: true, message: 'RichPost i Feed utworzone.' });
  } catch (error) {
    console.error('Blad zapisu w Mongo:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Internal Server Error', code: 'MONGO_WRITE_FAILED', details: message });
  }
}

export async function postReactionUpdate(req: Request, res: Response): Promise<any> {
  const { userId, type, previousType } = req.body;

  if (typeof userId !== 'number' || !Number.isInteger(userId)) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_USER_ID', details: 'userId musi byc liczba calkowita.' });
  }

  if (typeof type !== 'string' || !type.trim()) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_TYPE', details: 'type musi byc niepustym stringiem.' });
  }

  try {
    await updateReactionsDistribution(userId, type, previousType);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Blad aktualizacji ActivityDaily.reactionsGiven:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Internal Server Error', code: 'REACTION_UPDATE_FAILED', details: message });
  }
}

// T18
export async function deleteRichPost(req: Request, res: Response): Promise<any> {
  const postIdParam = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;
  if (!postIdParam) {
    return res.status(400).json({ error: 'Validation Error', code: 'MISSING_POST_ID', details: 'Brak postId.' });
  }

  const postId = parseInt(postIdParam, 10);
  if (Number.isNaN(postId)) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_POST_ID', details: 'Nieprawidlowy postId.' });
  }

  try {
    await cascadeDeleteRichPost(postId);
    return res.status(204).send();
  } catch (error) {
    console.error('Blad kaskadowego usuwania w Mongo:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Internal Server Error', code: 'MONGO_DELETE_FAILED', details: message });
  }
}
