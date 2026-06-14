import { Router } from 'express';
import { listTags, createTag, attachTag, postsByTag } from '../controllers/tagsController.js';
import { requireAuth, requireRole, provisionUser } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth, requireRole('User', 'Admin', 'Moderator'), provisionUser);

router.get('/', listTags);
router.get('/:name/posts', postsByTag);
// Tworzenie tagow / przypisywanie - tylko uprzywilejowani (wymóg: Admin dodaje tagi).
router.post('/', requireRole('Admin'), createTag);
router.post('/attach', requireRole('Admin', 'Moderator'), attachTag);

export default router;
