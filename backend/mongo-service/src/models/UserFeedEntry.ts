import mongoose, { Schema, Document } from 'mongoose';

export interface IUserFeedEntry extends Document {
  userId: number; // ID użytkownika, do którego należy ten feed (obserwującego)
  postId: number; // ID utworzonego posta
  score: number;  // Wynik do sortowania algorytmicznego
  insertedAt: Date;
}

const UserFeedEntrySchema = new Schema<IUserFeedEntry>({
  // Indeks na userId jest kluczowy dla wydajności przy pobieraniu feedu (Wymóg T7)
  userId: { type: Number, required: true, index: true },
  postId: { type: Number, required: true },
  score: { type: Number, default: 1 },
  insertedAt: { type: Date, default: Date.now, index: true }
});

export const UserFeedEntry = mongoose.model<IUserFeedEntry>('UserFeedEntry', UserFeedEntrySchema);