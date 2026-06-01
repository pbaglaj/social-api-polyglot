import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/sequelize.js';

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
