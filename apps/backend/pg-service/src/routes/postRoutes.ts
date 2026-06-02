import { Router } from 'express';
import { createPost, listPosts, addReaction, deletePost, createComment, listComments } from '../controllers/postController.js';
import { cacheGet } from '../middlewares/cache.js';
import { requireAuth, requireRole, provisionUser } from '../middlewares/auth.js';

const router = Router();

// Kazde zadanie wymaga waznego tokenu + roli czlowieka (pg-service to API dla
// uzytkownikow - klient M2M 'analytics' nie ma tu wstepu). Potem mapujemy tozsamosc.
router.use(requireAuth, requireRole('User', 'Admin', 'Moderator'), provisionUser);

router.get('/', cacheGet('posts:list'), listPosts);
router.post('/', createPost);
router.post('/:id/reactions', addReaction);
router.delete('/:id', deletePost); // wlasciciel LUB Admin/Moderator (sprawdzane w kontrolerze)
router.post('/:id/comments', createComment);
router.get('/:id/comments', cacheGet('posts:comments'), listComments);

export default router;
