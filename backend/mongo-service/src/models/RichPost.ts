import mongoose, { Schema, Document, Model } from 'mongoose';

interface IAttachment {
  url: string;
  type: 'image' | 'video' | 'link';
}

// Subdokument dla załączników (Wymóg T6: tablica zagnieżdżona)
const AttachmentSchema = new Schema<IAttachment>({
  url: { type: String, required: true },
  type: { type: String, enum: ['image', 'video', 'link'], required: true }
}, { _id: false });

export interface IRichPost extends Document {
  postId: number; // Referencja do ID z PostgreSQL
  attachments: IAttachment[];
  poll?: { question: string; options: string[] };
  updatedAt: Date;
}

interface RichPostModel extends Model<IRichPost> {
  findByPostId(postId: number): Promise<IRichPost | null>;
}

const RichPostSchema = new Schema<IRichPost, RichPostModel>({
  postId: { type: Number, required: true, unique: true },
  attachments: {
    type: [AttachmentSchema],
    validate: {
      // Niestandardowy walidator (Wymóg T6)
      validator: function(v: any[]) {
        return v.length <= 4; 
      },
      message: 'Post może mieć maksymalnie 4 załączniki.'
    }
  },
  poll: {
    question: String,
    options: [String]
  },
  updatedAt: { type: Date, default: Date.now }
});

// Pre hook: Automatyczna aktualizacja daty (Wymóg T6)
RichPostSchema.pre('save', function() {
  this.updatedAt = new Date();
});

// Statics: Metoda wyszukująca (Wymóg T6)
RichPostSchema.statics.findByPostId = function(postId: number) {
  return this.findOne({ postId });
};

// Indeks ułatwiający szybkie wyszukiwanie
RichPostSchema.index({ postId: 1 });

export const RichPost = mongoose.model<IRichPost, RichPostModel>('RichPost', RichPostSchema);