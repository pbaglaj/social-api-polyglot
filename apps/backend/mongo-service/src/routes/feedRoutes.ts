import { Router } from 'express';
import { getFeed } from '../controllers/feedController.js';

const router = Router();

router.get('/:userId', getFeed);

export default router;
