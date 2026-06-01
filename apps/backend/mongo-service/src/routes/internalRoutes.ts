import { Router } from 'express';
import { postRichPost, postReactionUpdate, deleteRichPost } from '../controllers/internalController.js';

const router = Router();

router.post('/rich-posts', postRichPost);
router.post('/reactions', postReactionUpdate);
router.delete('/rich-posts/:postId', deleteRichPost);

export default router;
