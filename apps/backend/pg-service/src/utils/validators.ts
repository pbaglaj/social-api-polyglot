export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validatePost(data: any): { authorId: number, bodyPreview: string, attachments?: string[], poll?: any } {
  if (!data.authorId || typeof data.authorId !== 'number') {
    throw new ValidationError('Id autora musi być liczbą.');
  }

  if (!data.bodyPreview || typeof data.bodyPreview !== 'string' || data.bodyPreview.trim() === '') {
    throw new ValidationError('Treść posta nie może być pusta.');
  }

  if (data.bodyPreview.length > 255) {
    throw new ValidationError('Treść musi mieć od 1 do 255 znaków.');
  }

  if (data.attachments && !Array.isArray(data.attachments)) {
    throw new ValidationError('Załączniki muszą być tablicą.');
  }

  return {
    authorId: data.authorId,
    bodyPreview: data.bodyPreview,
    attachments: data.attachments,
    poll: data.poll
  };
}

// Edycja posta: walidujemy wylacznie nowa tresc (autorstwo wynika z tokenu/wlasciciela,
// nie zmieniamy go przy edycji). Te same reguly co dla bodyPreview przy tworzeniu.
export function validatePostEdit(data: any): { bodyPreview: string } {
  if (!data.bodyPreview || typeof data.bodyPreview !== 'string' || data.bodyPreview.trim() === '') {
    throw new ValidationError('Treść posta nie może być pusta.');
  }

  if (data.bodyPreview.length > 255) {
    throw new ValidationError('Treść musi mieć od 1 do 255 znaków.');
  }

  return { bodyPreview: data.bodyPreview };
}

export function validateComment(data: any): { authorId: number, content: string, parentId?: number | null } {
  if (!data.authorId || typeof data.authorId !== 'number') {
    throw new ValidationError('Id autora musi być liczbą.');
  }

  if (!data.content || typeof data.content !== 'string' || data.content.trim() === '') {
    throw new ValidationError('Treść komentarza nie może być pusta.');
  }

  return {
    authorId: data.authorId,
    content: data.content,
    parentId: data.parentId
  };
}
