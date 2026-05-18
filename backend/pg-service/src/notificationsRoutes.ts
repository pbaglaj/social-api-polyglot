import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import sequelize, { Notification, NotificationType } from './sequelize.js';

const router = Router();

// T3 - eager loading przez `include` w endpoincie.
router.get('/:userId', async (req: Request, res: Response, next: NextFunction) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'INVALID_USER_ID',
      details: 'userId musi być liczbą całkowitą.'
    });
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
});

// POST /api/notifications - tworzenie powiadomienia.
// Walidatory Sequelize uruchamiają się automatycznie.
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const { userId, typeName, message, relatedPostId } = req.body || {};

  if (!Number.isInteger(userId)) {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'INVALID_USER_ID',
      details: 'userId musi być liczbą całkowitą.'
    });
  }

  if (typeof typeName !== 'string' || !typeName.trim()) {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'INVALID_TYPE_NAME',
      details: 'typeName musi być niepustym stringiem.'
    });
  }

  try {
    const type = await NotificationType.findOne({ where: { name: typeName.trim().toLowerCase() } });
    if (!type) {
      return res.status(404).json({
        error: 'Not Found',
        code: 'NOTIFICATION_TYPE_NOT_FOUND',
        details: `Typ powiadomienia "${typeName}" nie istnieje.`
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
});

// PATCH /api/notifications/:userId/read-all - oznacz wszystkie jako przeczytane.
// T3 - transakcja zarządzana (managed transaction).
router.patch('/:userId/read-all', async (req: Request, res: Response, next: NextFunction) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'INVALID_USER_ID',
      details: 'userId musi być liczbą całkowitą.'
    });
  }

  try {
    // Sequelize.transaction(async (t) => ...) - "managed" wariant z auto-COMMIT/ROLLBACK.
    const result = await sequelize.transaction(async (t) => {
      const [updated] = await Notification.update(
        { isRead: true },
        { where: { userId, isRead: false }, transaction: t }
      );

      // Tworzymy potwierdzenie systemowe (typ "mention" jako audit) w tej samej transakcji.
      const mentionType = await NotificationType.findOne({ where: { name: 'mention' }, transaction: t });
      if (mentionType && updated > 0) {
        await Notification.create(
          {
            userId,
            typeId: mentionType.id,
            message: `Oznaczono ${updated} powiadomień jako przeczytane.`,
            isRead: true,
          } as any,
          { transaction: t }
        );
      }

      return updated;
    });

    res.json({ markedAsRead: result });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/notifications/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({
      error: 'Validation Error',
      code: 'INVALID_NOTIFICATION_ID',
      details: 'id musi być liczbą całkowitą.'
    });
  }

  try {
    const deleted = await Notification.destroy({ where: { id } });
    if (deleted === 0) {
      return res.status(404).json({
        error: 'Not Found',
        code: 'NOTIFICATION_NOT_FOUND',
        details: 'Powiadomienie nie istnieje.'
      });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
