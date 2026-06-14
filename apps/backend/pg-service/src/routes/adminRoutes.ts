import { Router } from 'express';
import { requireAuth, requireRole, provisionUser } from '../middlewares/auth.js';
import {
  listKcUsers,
  createKcUser,
  assignRoles,
  revokeRoles,
  resetUserPassword,
  whoami,
} from '../controllers/adminController.js';

const router = Router();

// /api/admin/me - tozsamosc zalogowanego (kazdy uwierzytelniony).
router.get('/me', requireAuth, provisionUser, whoami);

// Reszta - tylko Admin. Zarzadzanie userami przez Keycloak Admin REST API.
router.use(requireAuth, requireRole('Admin'));

router.get('/users', listKcUsers);
router.post('/users', createKcUser);
router.post('/users/:id/roles', assignRoles);
router.delete('/users/:id/roles', revokeRoles);
router.put('/users/:id/password', resetUserPassword);

export default router;
