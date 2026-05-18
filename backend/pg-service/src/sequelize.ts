import { Sequelize, DataTypes, Model } from 'sequelize';

const globalForSequelize = globalThis as unknown as {
  sequelize?: Sequelize;
  sequelizeInitialised?: boolean;
};

function createSequelize(): Sequelize {
  const url = process.env.DATABASE_URL;
  // Bez DATABASE_URL: instancja postgres bez prób łączenia (testy mockują Model.*).
  return new Sequelize(url || 'postgres://nouser:nopass@localhost:5432/nodb', {
    dialect: 'postgres',
    logging: process.env.SEQUELIZE_LOGGING === 'true' ? console.log : false,
    pool: { max: Number(process.env.SEQUELIZE_POOL_MAX || 5), min: 0, idle: 10_000 },
    define: {
      freezeTableName: true,
      timestamps: true,
      underscored: true,
    },
  });
}

if (!globalForSequelize.sequelize) {
  globalForSequelize.sequelize = createSequelize();
}

const sequelize = globalForSequelize.sequelize as Sequelize;

// ===== Model 1: NotificationType =====
// T3 - walidator niestandardowy: priority w zakresie 0-10.
export class NotificationType extends Model {
  declare id: number;
  declare name: string;
  declare icon: string | null;
  declare priority: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

NotificationType.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: {
      type: DataTypes.STRING(32),
      allowNull: false,
      unique: true,
      validate: {
        len: { args: [2, 32], msg: 'Nazwa typu powiadomienia musi mieć 2-32 znaki.' },
        isLowercase: { msg: 'Nazwa typu powiadomienia musi być w lowercase.' },
      },
    },
    icon: {
      type: DataTypes.STRING(8),
      allowNull: true,
      validate: {
        len: { args: [1, 8], msg: 'Ikona musi mieć 1-8 znaków.' },
      },
    },
    priority: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5,
      validate: {
        isInRange(value: number) {
          if (!Number.isInteger(value) || value < 0 || value > 10) {
            throw new Error('priority musi być liczbą całkowitą w zakresie 0-10.');
          }
        },
      },
    },
  },
  { sequelize, modelName: 'NotificationType', tableName: 'notification_types' }
);

// ===== Model 2: Notification =====
// T3 - walidator niestandardowy: message niepusty, message niezbyt długi,
// hook domenowy beforeCreate (normalizacja message), relacja belongsTo NotificationType.
export class Notification extends Model {
  declare id: number;
  declare userId: number;
  declare typeId: number;
  declare message: string;
  declare isRead: boolean;
  declare relatedPostId: number | null;
  declare createdAt: Date;
  declare updatedAt: Date;
  declare type?: NotificationType;
}

Notification.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        isInt: { msg: 'userId musi być liczbą całkowitą.' },
        min: { args: [1], msg: 'userId musi być >= 1.' },
      },
    },
    typeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'type_id',
      validate: {
        isInt: { msg: 'typeId musi być liczbą całkowitą.' },
      },
    },
    message: {
      type: DataTypes.STRING(280),
      allowNull: false,
      validate: {
        notEmpty: { msg: 'message nie może być pusty.' },
        len: { args: [1, 280], msg: 'message musi mieć 1-280 znaków.' },
        noScript(value: string) {
          if (/<script/i.test(value)) {
            throw new Error('message nie może zawierać tagów <script>.');
          }
        },
      },
    },
    isRead: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    relatedPostId: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    sequelize,
    modelName: 'Notification',
    tableName: 'notifications',
    hooks: {
      // T3 - hook domenowy: normalizacja whitespace i odcięcie nadmiaru.
      beforeCreate(notification: Notification) {
        if (typeof notification.message === 'string') {
          notification.message = notification.message.trim().replace(/\s+/g, ' ');
        }
      },
      beforeBulkCreate(items: Notification[]) {
        items.forEach((n) => {
          if (typeof n.message === 'string') {
            n.message = n.message.trim().replace(/\s+/g, ' ');
          }
        });
      },
    },
  }
);

// T3 - relacja używana w endpointach (eager loading przez `include`).
Notification.belongsTo(NotificationType, { foreignKey: 'typeId', as: 'type' });
NotificationType.hasMany(Notification, { foreignKey: 'typeId', as: 'notifications' });

// Static method (T3 - "methods or statics")
(Notification as any).markAllAsRead = async function (userId: number) {
  const [affectedCount] = await Notification.update(
    { isRead: true },
    { where: { userId, isRead: false } }
  );
  return affectedCount;
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
  ];
  for (const s of seeds) {
    await NotificationType.findOrCreate({ where: { name: s.name }, defaults: s });
  }

  globalForSequelize.sequelizeInitialised = true;
  console.log('[sequelize] modele zainicjalizowane.');
}

export default sequelize;
