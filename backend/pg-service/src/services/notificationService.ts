import sequelize from '../config/sequelize.js';
import { Notification } from '../models/Notification.js';
import { NotificationType } from '../models/NotificationType.js';

// T3 - transakcja zarządzana (managed transaction).
// Oznacza wszystkie nieprzeczytane jako przeczytane i zostawia audit-trail w postaci
// pojedynczego powiadomienia typu "mention".
export async function markAllReadInTransaction(userId: number): Promise<number> {
  return sequelize.transaction(async (t) => {
    const [updated] = await Notification.update(
      { isRead: true },
      { where: { userId, isRead: false }, transaction: t }
    );

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
}
