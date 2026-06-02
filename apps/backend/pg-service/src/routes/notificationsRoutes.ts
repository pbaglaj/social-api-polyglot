import { Router } from 'express';
import { listForUser, create, markAllRead, remove } from '../controllers/notificationsController.js';
import { requireAuth, requireRole, provisionUser } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth, requireRole('User', 'Admin', 'Moderator'), provisionUser);
router.get('/:userId', listForUser);
router.post('/', create);
router.patch('/:userId/read-all', markAllRead);
router.delete('/:id', remove);

export default router;
