import mongoose from 'mongoose';
import { MongoClient, Db } from 'mongodb';

let nativeClient: MongoClient;
let nativeDb: Db;

export const connectDB = async () => {
  const uri = process.env.MONGO_URI || 'mongodb://mongo:secret@localhost:27017/feed_db?authSource=admin';

  try {
    // Mongoose (dla modeli, walidacji, pre-hooków - wymóg T6)
    await mongoose.connect(uri);
    console.log('Mongoose połączone z MongoDB.');

    // Native MongoClient Singleton (dla specyficznych zasobów - wymóg T5)
    nativeClient = new MongoClient(uri);
    await nativeClient.connect();
    nativeDb = nativeClient.db();
    console.log('Natywny klient MongoDB połączony.');

    // Zamykanie połączeń przy SIGINT (Wymóg T5)
    process.on('SIGINT', async () => {
      console.log('\nZamykanie połączeń z MongoDB (SIGINT)...');
      await mongoose.connection.close();
      if (nativeClient) {
        await nativeClient.close();
      }
      process.exit(0);
    });

  } catch (error) {
    console.error('Błąd połączenia z MongoDB:', error);
    process.exit(1);
  }
};

export const getNativeDb = () => nativeDb;