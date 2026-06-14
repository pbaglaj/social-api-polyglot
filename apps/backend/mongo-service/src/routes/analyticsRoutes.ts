import { Router } from 'express';
import {
  createSystemLog,
  listSystemLogs,
  trending,
  topAuthorsWeekly,
  reactionDistribution,
} from '../controllers/analyticsController.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

// Analityke czytaja zalogowani uzytkownicy ORAZ klient M2M (rola serwisowa 'analytics').
const ANALYTICS_READERS = requireRole('analytics', 'User', 'Admin', 'Moderator');

router.get('/trending', requireAuth, ANALYTICS_READERS, trending);
router.get('/top-authors-weekly', requireAuth, ANALYTICS_READERS, topAuthorsWeekly);
router.get('/reaction-distribution', requireAuth, ANALYTICS_READERS, reactionDistribution);

// Zapis/odczyt logow systemowych - zalogowany uzytkownik.
router.post('/system-logs', requireAuth, requireRole('User', 'Admin', 'Moderator'), createSystemLog);
router.get('/system-logs', requireAuth, requireRole('User', 'Admin', 'Moderator', 'analytics'), listSystemLogs);

export default router;
