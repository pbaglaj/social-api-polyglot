import { Router } from 'express';
import { createPost, listPosts, addReaction, deletePost, createComment, listComments } from '../controllers/postController.js';
import { cacheGet } from '../middlewares/cache.js';

const router = Router();

router.post('/', createPost);
router.get('/', cacheGet('posts:list'), listPosts);
router.post('/:id/reactions', addReaction);
router.delete('/:id', deletePost);
router.post('/:id/comments', createComment);
router.get('/:id/comments', cacheGet('posts:comments'), listComments);

export default router;
