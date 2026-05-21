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

// Fan-out powiadomien "new_post" do followers po publikacji posta.
// Best-effort - blad przy zapisie powiadomien nie wycofuje opublikowanego posta.
export async function notifyFollowersAboutNewPost(params: {
  authorId: number;
  authorUsername?: string | null;
  postId: number;
  followerIds: number[];
}): Promise<number> {
  const { authorId, authorUsername, postId, followerIds } = params;
  if (!Array.isArray(followerIds) || followerIds.length === 0) return 0;

  const type = await NotificationType.findOne({ where: { name: 'new_post' } });
  if (!type) {
    console.warn('[notifications] Typ "new_post" nie istnieje - pomijam powiadomienia.');
    return 0;
  }

  const displayName = (authorUsername && authorUsername.trim()) || `user#${authorId}`;
  const message = `${displayName} dodal(a) nowy post.`.slice(0, 280);

  const rows = followerIds.map((userId) => ({
    userId,
    typeId: type.id,
    message,
    relatedPostId: postId,
    isRead: false,
  }));

  const created = await Notification.bulkCreate(rows as any, { validate: true });
  return created.length;
}
