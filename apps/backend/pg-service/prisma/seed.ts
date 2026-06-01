import { faker } from '@faker-js/faker';
import prisma from '../src/config/prisma.ts'; // Importujemy klienta Prisma do bezpośredniego użycia w seedowaniu

// Główna funkcja wyciągnięta na zewnątrz do łatwego testowania
export async function seedDatabase(dbClient: any) {
  console.log('Beginning seed process...');

  const createdUsers = [];

  for (let i = 0; i < 10; i++) {
    const user = await dbClient.user.create({
      data: {
        // Zabezpieczenie przed powtórzeniami poprzez dodanie losowych cyfr do nazwy
        username: faker.internet.username() + faker.string.numeric(3),
        email: faker.internet.email(),
      },
    });
    createdUsers.push(user);
  }
  console.log(`Generated ${createdUsers.length} random users.`);

  // Generowanie postów, komentarzy i relacji dla każdego użytkownika
  for (const user of createdUsers) {
    const post = await dbClient.post.create({
      data: {
        authorId: user.id,
        bodyPreview: faker.lorem.sentence({ min: 5, max: 15 }).substring(0, 255),
      },
    });

    // Szukamy innego użytkownika, który skomentuje post i zaobserwuje autora
    const otherUser = createdUsers.find(u => u.id !== user.id) || createdUsers[0];

    // Losowy komentarz
    await dbClient.comment.create({
      data: {
        postId: post.id,
        authorId: otherUser.id,
        content: faker.lorem.words({ min: 3, max: 8 }),
      },
    });

    // Inny użytkownik zaczyna obserwować autora
    // W bloku try-catch na wypadek, gdyby Faker wylosował tę samą parę drugi raz
    try {
      await dbClient.follow.create({
        data: {
          followerId: otherUser.id,
          followeeId: user.id,
        },
      });
    } catch (e) {
      // Ignorujemy błędy unikalności klucza w systemie obserwacji podczas seedowania
    }
  }

  console.log('Generated random posts, comments and relationships.');
}

// Skrypt uruchamia się tylko, jeśli nie jesteśmy w środowisku testowym (Jesta)
if (process.env.NODE_ENV !== 'test') {
  seedDatabase(prisma)
    .catch((e) => {
      console.error('Error during seeding:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}