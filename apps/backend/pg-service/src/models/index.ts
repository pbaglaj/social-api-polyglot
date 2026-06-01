import sequelize from '../config/sequelize.js';
import { Notification } from './Notification.js';
import { NotificationType } from './NotificationType.js';

const globalForSequelize = globalThis as unknown as {
  sequelizeInitialised?: boolean;
};

export async function initSequelize(): Promise<void> {
  if (globalForSequelize.sequelizeInitialised) return;

  // Synchronizacja modeli (tylko CREATE TABLE IF NOT EXISTS - addytywne).
  await sequelize.authenticate();
  await NotificationType.sync();
  await Notification.sync();

  // Seed kanonicznych typów (idempotentny).
  const seeds = [
    { name: 'follow',   icon: '👤', priority: 3 },
    { name: 'reaction', icon: '❤️', priority: 4 },
    { name: 'comment',  icon: '💬', priority: 6 },
    { name: 'mention',  icon: '@',  priority: 7 },
    { name: 'new_post', icon: '📝', priority: 5 },
  ];
  for (const s of seeds) {
    await NotificationType.findOrCreate({ where: { name: s.name }, defaults: s });
  }

  globalForSequelize.sequelizeInitialised = true;
  console.log('[sequelize] modele zainicjalizowane.');
}

export { Notification, NotificationType };
export { default as sequelize } from '../config/sequelize.js';
