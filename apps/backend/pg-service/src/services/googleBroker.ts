// SZKIELET Fazy 4 (wyzsza ocena): integracja z zewnetrznym API chronionym OAuth2 (Google)
// przez Keycloak Identity Brokering.
//
// Przeplyw: uzytkownik loguje sie do Keycloak przez Google (IdP brokering). Keycloak
// przechowuje Google Access Token (storeToken=true). Nasz backend pobiera ten token z
// Keycloak Broker API i wola Google Calendar API w imieniu uzytkownika.
//
// Endpoint jest DORMANT dopoki IdP 'google' nie jest wlaczony i nie ma credentials
// (Google Cloud Console). Patrz docs/oauth2.md -> "Faza 4 - Google".

const KC_URL = process.env.KEYCLOAK_INTERNAL_URL || 'http://keycloak:8080';
const REALM = process.env.KEYCLOAK_REALM || 'SocialPolyglot';
const PROVIDER = process.env.GOOGLE_BROKER_ALIAS || 'google';
const CALENDAR_URL =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=10&singleEvents=true&orderBy=startTime&timeMin=';

export class GoogleNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleNotConfiguredError';
  }
}

interface BrokerTokenResponse {
  access_token?: string;
  [k: string]: unknown;
}

/**
 * Broker token API waliduje issuer tokenu wzgledem hosta zadania. Backend laczy sie po sieci
 * docker (keycloak:8080), ale token usera ma issuer publiczny (localhost:8090) - bez korekty
 * Keycloak odrzuca go jako "Invalid token" (400). Z KC_PROXY_HEADERS=xforwarded Keycloak ufa
 * naglowkom X-Forwarded-*, wiec odtwarzamy z nich oryginalny (publiczny) origin tokenu.
 * Issuer bierzemy z samego JWT - jest juz zweryfikowany przez requireAuth (allowlist), zanim
 * trafi tutaj, wiec to zaufana wartosc, nie surowy input.
 */
function issuerForwardHeaders(userBearer: string): Record<string, string> {
  try {
    const part = userBearer.split('.')[1];
    if (!part) return {};
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { iss?: string };
    if (!payload.iss) return {};
    const u = new URL(payload.iss);
    return {
      'X-Forwarded-Proto': u.protocol.replace(':', ''),
      'X-Forwarded-Host': u.host, // host zawiera :port jezeli niestandardowy
      'X-Forwarded-Port': u.port || (u.protocol === 'https:' ? '443' : '80'),
    };
  } catch {
    return {};
  }
}

/**
 * Pobiera Google Access Token z Keycloak Broker API uzywajac tokenu zalogowanego usera.
 * Keycloak zwraca przechowywany token zewnetrznego dostawcy (jezeli storeToken=true i user
 * zalogowal sie przez Google). Rzuca GoogleNotConfiguredError, gdy IdP nieaktywny / brak linku.
 */
export async function getGoogleAccessToken(userBearer: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${KC_URL}/realms/${REALM}/broker/${PROVIDER}/token`, {
      headers: { Authorization: `Bearer ${userBearer}`, ...issuerForwardHeaders(userBearer) },
    });
  } catch (e) {
    throw new GoogleNotConfiguredError(`Nie udalo sie polaczyc z Keycloak Broker API: ${(e as Error).message}`);
  }

  if (res.status === 400 || res.status === 404) {
    throw new GoogleNotConfiguredError(
      `Broker '${PROVIDER}' niedostepny (status ${res.status}). Wlacz IdP Google w realmie i zaloguj sie przez Google.`,
    );
  }
  if (!res.ok) {
    throw new GoogleNotConfiguredError(`Broker token error ${res.status}: ${await res.text()}`);
  }

  // Keycloak zwraca albo JSON, albo form-encoded (access_token=...&...).
  const raw = await res.text();
  let token: string | undefined;
  try {
    token = (JSON.parse(raw) as BrokerTokenResponse).access_token;
  } catch {
    token = new URLSearchParams(raw).get('access_token') ?? undefined;
  }
  if (!token) throw new GoogleNotConfiguredError('Brak Google access_token w odpowiedzi brokera.');
  return token;
}

export interface CalendarItem {
  source: 'google_calendar';
  title: string;
  start: string | null;
  end: string | null;
  htmlLink?: string;
}

/** Pobiera nadchodzace wydarzenia z Google Calendar i mapuje je na pozycje do feedu. */
export async function fetchUpcomingEvents(googleToken: string): Promise<CalendarItem[]> {
  const res = await fetch(CALENDAR_URL + encodeURIComponent(new Date().toISOString()), {
    headers: { Authorization: `Bearer ${googleToken}` },
  });
  if (!res.ok) {
    throw new GoogleNotConfiguredError(`Google Calendar API ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { items?: Array<Record<string, any>> };
  return (data.items ?? []).map((ev) => ({
    source: 'google_calendar' as const,
    title: ev.summary ?? '(bez tytulu)',
    start: ev.start?.dateTime ?? ev.start?.date ?? null,
    end: ev.end?.dateTime ?? ev.end?.date ?? null,
    htmlLink: ev.htmlLink,
  }));
}
