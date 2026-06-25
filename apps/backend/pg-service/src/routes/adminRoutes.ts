import { Router } from 'express';
import { requireAuth, requireRole, provisionUser } from '../middlewares/auth.js';
import {
  listKcUsers,
  createKcUser,
  assignRoles,
  revokeRoles,
  resetUserPassword,
  recoverPassword,
  enableMfa,
  disableMfa,
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
// Odzyskiwanie hasla (recovery) - mail z linkiem resetu lub wymagana akcja UPDATE_PASSWORD.
router.post('/users/:id/recover-password', recoverPassword);
// 2FA/MFA (TOTP) - wlaczenie (wymuszenie konfiguracji) / wylaczenie.
router.post('/users/:id/mfa', enableMfa);
router.delete('/users/:id/mfa', disableMfa);

export default router;
