import { Router } from 'express';
import { userStats, topPosts } from '../controllers/statsController.js';

const router = Router();

router.get('/user/:id', userStats);
router.get('/posts/top', topPosts);

export default router;
