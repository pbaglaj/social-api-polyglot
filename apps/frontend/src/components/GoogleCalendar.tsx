import { useState } from 'react';
import { useApi } from '../api';
import type { ApiError } from '../api';

interface CalendarItem {
  source: 'google_calendar';
  title: string;
  start: string | null;
  end: string | null;
  htmlLink?: string;
}

interface CalendarResponse {
  source: 'google_calendar';
  count: number;
  events: CalendarItem[];
}

// Faza 4 — Google Identity Brokering. Wola GET /api/google/calendar: backend pobiera
// Google Access Token z Keycloak Broker API (tokenem zalogowanego usera) i odpytuje
// Google Calendar API. Dziala dopiero gdy user zalogowal sie przez Google (powiazane konto).
export function GoogleCalendar() {
  const { request } = useApi();
  const [events, setEvents] = useState<CalendarItem[]>([]);
  const [status, setStatus] = useState('');

  async function load() {
    setStatus('Fetching from Google Calendar…');
    setEvents([]);
    try {
      const res = await request<CalendarResponse>('/google/calendar');
      const items = res?.events ?? [];
      setEvents(items);
      setStatus(items.length ? `Fetched ${items.length} events.` : 'No upcoming events.');
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'GOOGLE_NOT_CONFIGURED') {
        setStatus('Google not linked: sign in with "Google" on the Keycloak screen. ' + err.message);
      } else {
        setStatus('Error: ' + err.message);
      }
    }
  }

  return (
    <section className="panel" id="google-calendar">
      <h2>Google Calendar (Identity Brokering)</h2>
      <div className="row">
        <button onClick={() => void load()}>Get upcoming events</button>
      </div>
      {status && <div className="status">{status}</div>}
      <ul>
        {events.map((ev, i) => (
          <li key={i} className="feed-entry">
            <div className="post-header">
              {ev.start ? new Date(ev.start).toLocaleString() : '(no date)'}
            </div>
            <div className="post-body">
              {ev.htmlLink ? (
                <a href={ev.htmlLink} target="_blank" rel="noreferrer">
                  {ev.title}
                </a>
              ) : (
                ev.title
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
