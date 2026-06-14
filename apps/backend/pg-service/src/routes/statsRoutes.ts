import { Router } from 'express';
import { userStats, topPosts } from '../controllers/statsController.js';
import { requireAuth, requireRole, provisionUser } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth, requireRole('User', 'Admin', 'Moderator'), provisionUser);
router.get('/user/:id', userStats);
router.get('/posts/top', topPosts);

export default router;
