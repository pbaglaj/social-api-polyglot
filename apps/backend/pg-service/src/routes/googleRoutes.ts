import { Router } from 'express';
import { googleCalendarFeed } from '../controllers/googleController.js';
import { requireAuth, requireRole, provisionUser } from '../middlewares/auth.js';

const router = Router();

// SZKIELET Fazy 4 - integracja z zewnetrznym API (Google Calendar) przez Keycloak broker.
// Dostepne dla zalogowanego uzytkownika. Endpoint dziala dopiero po wlaczeniu IdP 'google'.
router.use(requireAuth, requireRole('User', 'Admin', 'Moderator'), provisionUser);

router.get('/calendar', googleCalendarFeed);

export default router;
