import { MongoClient, Db } from 'mongodb';

// T5: Singleton MongoClient (natywny sterownik).
// Trzymany na globalThis żeby przeżyć hot-reload / wielokrotne importy w dev.
const globalForMongo = globalThis as unknown as {
  nativeClient?: MongoClient;
  nativeDb?: Db;
};

let nativeClient: MongoClient | undefined;
let nativeDb: Db | undefined;

export async function connectNativeClient(uri: string): Promise<void> {
  if (!globalForMongo.nativeClient) {
    const client = new MongoClient(uri);
    await client.connect();
    globalForMongo.nativeClient = client;
    globalForMongo.nativeDb = client.db();

    // Indeks złożony dla kolekcji obsługiwanej przez sterownik natywny (T5).
    await globalForMongo.nativeDb.collection('system_logs').createIndex({ level: 1, insertedAt: -1 });

    console.log('Natywny klient MongoDB połączony (new).');
  } else {
    console.log('Reusing existing native MongoDB client.');
  }

  nativeClient = globalForMongo.nativeClient;
  nativeDb = globalForMongo.nativeDb;
}

export async function disconnectNativeClient(): Promise<void> {
  if (globalForMongo.nativeClient) {
    await globalForMongo.nativeClient.close();
  }
}

export const getNativeDb = () => globalForMongo.nativeDb ?? nativeDb;
export const getNativeClient = () => globalForMongo.nativeClient ?? nativeClient;
