import type { Request, Response, NextFunction } from 'express';
import { getGoogleAccessToken, fetchUpcomingEvents, GoogleNotConfiguredError } from '../services/googleBroker.js';

// SZKIELET Fazy 4. Zwraca nadchodzace wydarzenia z Google Calendar zalogowanego usera,
// gotowe do wstrzykniecia do feedu. Gdy IdP Google nie jest skonfigurowany / user nie
// powiazal konta - zwraca 503 z czytelnym komunikatem (NIE 500), zeby nie psuc reszty API.

function extractBearer(req: Request): string | null {
  const h = req.headers.authorization;
  return h && h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

export async function googleCalendarFeed(req: Request, res: Response, next: NextFunction) {
  const userBearer = extractBearer(req);
  if (!userBearer) {
    return res.status(401).json({ error: 'Unauthorized', code: 'NO_TOKEN', details: 'Brak tokenu uzytkownika.' });
  }

  try {
    const googleToken = await getGoogleAccessToken(userBearer);
    const events = await fetchUpcomingEvents(googleToken);
    res.json({ source: 'google_calendar', count: events.length, events });
  } catch (err) {
    if (err instanceof GoogleNotConfiguredError) {
      return res.status(503).json({
        error: 'Service Unavailable',
        code: 'GOOGLE_NOT_CONFIGURED',
        details: err.message,
      });
    }
    next(err);
  }
}
