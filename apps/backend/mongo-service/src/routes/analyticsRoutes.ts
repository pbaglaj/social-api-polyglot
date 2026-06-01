import { Router } from 'express';
import {
  createSystemLog,
  listSystemLogs,
  trending,
  topAuthorsWeekly,
  reactionDistribution,
} from '../controllers/analyticsController.js';

const router = Router();

router.post('/system-logs', createSystemLog);
router.get('/system-logs', listSystemLogs);
router.get('/trending', trending);
router.get('/top-authors-weekly', topAuthorsWeekly);
router.get('/reaction-distribution', reactionDistribution);

export default router;
