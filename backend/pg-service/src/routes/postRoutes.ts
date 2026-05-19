import { Router } from 'express';
import { createPost, listPosts, addReaction, deletePost, createComment, listComments } from '../controllers/postController.js';

const router = Router();

router.post('/', createPost);
router.get('/', listPosts);
router.post('/:id/reactions', addReaction);
router.delete('/:id', deletePost);
router.post('/:id/comments', createComment);
router.get('/:id/comments', listComments);

export default router;
