import mongoose, { Schema, Document } from 'mongoose';

export interface IActivityDaily extends Document {
  day: Date;
  authorId: number;
  postsCreated: number;
  updatedAt: Date;
}

const ActivityDailySchema = new Schema<IActivityDaily>({
  day: { type: Date, required: true, index: true },
  authorId: { type: Number, required: true, index: true },
  postsCreated: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
});

ActivityDailySchema.index({ day: 1, authorId: 1 }, { unique: true });

export const ActivityDaily = mongoose.model<IActivityDaily>('ActivityDaily', ActivityDailySchema);
