import mongoose from 'mongoose';

// T6: konfiguracja Mongoose.
// Idempotentne łączenie - jeśli już połączone (readyState 1), nie próbujemy ponownie.
export async function connectMongoose(uri: string): Promise<void> {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(uri);
    console.log('Mongoose połączone z MongoDB.');
  } else {
    console.log('Mongoose already connected to MongoDB.');
  }
}

export async function disconnectMongoose(): Promise<void> {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
  }
}
