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
  score: {
    type: Number,
    default: 1,
    validate: {
      // Niestandardowy walidator (drugi schemat z walidacją wymagany w T6)
      validator: (value: number) => value >= 0 && value <= 100,
      message: 'Score musi być w zakresie 0-100.'
    }
  },
  insertedAt: { type: Date, default: Date.now, index: true }
});

// Indeks zlozony pod paginacje feedu (userId + insertedAt)
UserFeedEntrySchema.index({ userId: 1, insertedAt: -1 });

// Virtual populate do pobierania danych RichPost po postId (Wymóg T6: populate)
UserFeedEntrySchema.virtual('richPost', {
  ref: 'RichPost',
  localField: 'postId',
  foreignField: 'postId',
  justOne: true
});

UserFeedEntrySchema.set('toJSON', { virtuals: true });
UserFeedEntrySchema.set('toObject', { virtuals: true });

export const UserFeedEntry = mongoose.model<IUserFeedEntry>('UserFeedEntry', UserFeedEntrySchema);