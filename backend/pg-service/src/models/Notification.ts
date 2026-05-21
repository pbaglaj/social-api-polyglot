import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/sequelize.js';
import { NotificationType } from './NotificationType.js';

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
