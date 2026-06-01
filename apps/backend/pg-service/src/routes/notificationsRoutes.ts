import { Router } from 'express';
import { listForUser, create, markAllRead, remove } from '../controllers/notificationsController.js';

const router = Router();

router.get('/:userId', listForUser);
router.post('/', create);
router.patch('/:userId/read-all', markAllRead);
router.delete('/:id', remove);

export default router;
