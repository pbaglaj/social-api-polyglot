import { Router } from 'express';
import { listTags, createTag, attachTag, postsByTag } from '../controllers/tagsController.js';

const router = Router();

router.get('/', listTags);
router.post('/', createTag);
router.post('/attach', attachTag);
router.get('/:name/posts', postsByTag);

export default router;
