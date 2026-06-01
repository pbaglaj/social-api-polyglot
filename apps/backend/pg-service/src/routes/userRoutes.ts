import { Router } from 'express';
import { listUsers, follow, unfollow } from '../controllers/userController.js';

const router = Router();

router.get('/', listUsers);
router.post('/:id/follow', follow);
router.delete('/:id/follow', unfollow);

export default router;
