import mongoose from 'mongoose';
import { MongoClient, Db } from 'mongodb';

let nativeClient: MongoClient | undefined;
let nativeDb: Db | undefined;

// Persist native client and db on globalThis to ensure a singleton across
// module reloads / multiple imports (useful during development/hot-reload).
const globalForMongo = globalThis as unknown as {
  nativeClient?: MongoClient;
  nativeDb?: Db;
  sigintHandlerInstalled?: boolean;
};

export const connectDB = async () => {
  const uri = process.env.MONGO_URI || 'mongodb://mongo:secret@localhost:27017/feed_db?authSource=admin';

  try {
    // Mongoose (dla modeli, walidacji, pre-hooków - wymóg T6)
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(uri);
      console.log('Mongoose połączone z MongoDB.');
    } else {
      console.log('Mongoose already connected to MongoDB.');
    }

    // Native MongoClient Singleton (dla specyficznych zasobów - wymóg T5)
    if (!globalForMongo.nativeClient) {
      const client = new MongoClient(uri);
      await client.connect();
      globalForMongo.nativeClient = client;
      globalForMongo.nativeDb = client.db();
      console.log('Natywny klient MongoDB połączony (new).');
    } else {
      console.log('Reusing existing native MongoDB client.');
    }

    nativeClient = globalForMongo.nativeClient;
    nativeDb = globalForMongo.nativeDb;

    // Install SIGINT handler only once
    if (!globalForMongo.sigintHandlerInstalled) {
      process.on('SIGINT', async () => {
        console.log('\nZamykanie połączeń z MongoDB (SIGINT)...');
        try {
          if (mongoose.connection.readyState === 1) await mongoose.connection.close();
          if (globalForMongo.nativeClient) await globalForMongo.nativeClient.close();
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

export const getNativeDb = () => globalForMongo.nativeDb ?? nativeDb;
export const getNativeClient = () => globalForMongo.nativeClient ?? nativeClient;