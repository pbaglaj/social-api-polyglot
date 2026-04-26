import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Rozpoczynam seedowanie bazy PostgreSQL...');
  
  const user1 = await prisma.user.upsert({
    where: { email: 'admin@social.local' },
    update: {},
    create: {
      username: 'admin',
      email: 'admin@social.local',
    },
  });

  console.log(`Utworzono użytkownika: ${user1.username}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });