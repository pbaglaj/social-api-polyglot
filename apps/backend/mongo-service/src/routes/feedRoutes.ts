import { Router } from 'express';
import { getFeed } from '../controllers/feedController.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

// Feed czyta zalogowany uzytkownik (User/Admin/Moderator).
router.get('/:userId', requireAuth, requireRole('User', 'Admin', 'Moderator'), getFeed);

export default router;
