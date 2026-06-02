import { Router } from 'express';
import { listUsers, follow, unfollow } from '../controllers/userController.js';
import { requireAuth, requireRole, provisionUser } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth, requireRole('User', 'Admin', 'Moderator'), provisionUser);

router.get('/', listUsers);
router.post('/:id/follow', follow);
router.delete('/:id/follow', unfollow);

export default router;
