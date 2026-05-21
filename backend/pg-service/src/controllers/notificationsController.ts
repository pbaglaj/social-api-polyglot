import type { Request, Response, NextFunction } from 'express';
import { Notification } from '../models/Notification.js';
import { NotificationType } from '../models/NotificationType.js';
import { markAllReadInTransaction } from '../services/notificationService.js';

// T3 - eager loading przez `include`.
export async function listForUser(req: Request, res: Response, next: NextFunction) {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_USER_ID', details: 'userId musi być liczbą całkowitą.' });
  }

  const unread = req.query.unread === 'true';
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);

  try {
    const where: any = { userId };
    if (unread) where.isRead = false;

    const notifications = await Notification.findAll({
      where,
      include: [{ model: NotificationType, as: 'type' }],
      order: [['createdAt', 'DESC']],
      limit,
    });

    res.json({ count: notifications.length, notifications });
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  const { userId, typeName, message, relatedPostId } = req.body || {};

  if (!Number.isInteger(userId)) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_USER_ID', details: 'userId musi być liczbą całkowitą.' });
  }

  if (typeof typeName !== 'string' || !typeName.trim()) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_TYPE_NAME', details: 'typeName musi być niepustym stringiem.' });
  }

  try {
    const type = await NotificationType.findOne({ where: { name: typeName.trim().toLowerCase() } });
    if (!type) {
      return res.status(404).json({
        error: 'Not Found',
        code: 'NOTIFICATION_TYPE_NOT_FOUND',
        details: `Typ powiadomienia "${typeName}" nie istnieje.`,
      });
    }

    const created = await Notification.create({
      userId,
      typeId: type.id,
      message,
      relatedPostId: relatedPostId ?? null,
    } as any);

    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
}

export async function markAllRead(req: Request, res: Response, next: NextFunction) {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_USER_ID', details: 'userId musi być liczbą całkowitą.' });
  }

  try {
    const markedAsRead = await markAllReadInTransaction(userId);
    res.json({ markedAsRead });
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Validation Error', code: 'INVALID_NOTIFICATION_ID', details: 'id musi być liczbą całkowitą.' });
  }

  try {
    const deleted = await Notification.destroy({ where: { id } });
    if (deleted === 0) {
      return res.status(404).json({ error: 'Not Found', code: 'NOTIFICATION_NOT_FOUND', details: 'Powiadomienie nie istnieje.' });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
