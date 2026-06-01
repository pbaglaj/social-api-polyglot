import { connectMongoose } from './mongoose.js';
import { connectNativeClient } from './nativeClient.js';

// Wspólny entrypoint dla obu połączeń (Mongoose + native).
// Graceful shutdown (SIGTERM/SIGINT) jest obsługiwany centralnie w src/index.ts.
export const connectDB = async (): Promise<void> => {
  const uri = process.env.MONGO_URI || 'mongodb://mongo:secret@localhost:27017/feed_db?authSource=admin';

  try {
    await connectMongoose(uri);
    await connectNativeClient(uri);
  } catch (error) {
    console.error('Błąd połączenia z MongoDB:', error);
    process.exit(1);
  }
};

export { getNativeDb, getNativeClient } from './nativeClient.js';
