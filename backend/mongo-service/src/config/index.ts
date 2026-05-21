import { connectMongoose, disconnectMongoose } from './mongoose.js';
import { connectNativeClient, disconnectNativeClient } from './nativeClient.js';

const globalForMongo = globalThis as unknown as {
  sigintHandlerInstalled?: boolean;
};

// Wspólny entrypoint dla obu połączeń (Mongoose + native).
// Zachowuje semantykę poprzedniego db.ts - exit(1) przy błędzie startu.
export const connectDB = async (): Promise<void> => {
  const uri = process.env.MONGO_URI || 'mongodb://mongo:secret@localhost:27017/feed_db?authSource=admin';

  try {
    await connectMongoose(uri);
    await connectNativeClient(uri);

    if (!globalForMongo.sigintHandlerInstalled) {
      process.on('SIGINT', async () => {
        console.log('\nZamykanie połączeń z MongoDB (SIGINT)...');
        try {
          await disconnectMongoose();
          await disconnectNativeClient();
        } catch (e) {
          console.error('Błąd podczas zamykania połączeń MongoDB:', e);
        }
        process.exit(0);
      });
      globalForMongo.sigintHandlerInstalled = true;
    }
  } catch (error) {
    console.error('Błąd połączenia z MongoDB:', error);
    process.exit(1);
  }
};

export { getNativeDb, getNativeClient } from './nativeClient.js';
