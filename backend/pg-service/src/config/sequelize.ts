import { Sequelize } from 'sequelize';

const globalForSequelize = globalThis as unknown as {
  sequelize?: Sequelize;
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

export default sequelize;
