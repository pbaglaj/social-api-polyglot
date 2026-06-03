import { useAuth } from 'react-oidc-context';
import { useWhoami } from './useWhoami';
import { Posts } from './components/Posts';
import { Users } from './components/Users';
import { Feed } from './components/Feed';
import { Tags } from './components/Tags';
import { Notifications } from './components/Notifications';
import { Stats } from './components/Stats';
import { Analytics } from './components/Analytics';
import { GoogleCalendar } from './components/GoogleCalendar';
import { AdminPanel } from './components/AdminPanel';

export default function App() {
  const auth = useAuth();
  const ready = auth.isAuthenticated;
  const { whoami, userId, roles, isAdmin, isModerator, isPrivileged } = useWhoami(ready);

  if (auth.isLoading) {
    return <div className="centered">Ładowanie sesji…</div>;
  }

  if (auth.error) {
    return (
      <div className="centered">
        <h2>Błąd logowania</h2>
        <p>{auth.error.message}</p>
        <button onClick={() => auth.signinRedirect()}>Spróbuj ponownie</button>
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <div className="centered login">
        <h1>Social Polyglot</h1>
        <p>Klient SPA — OAuth2 Authorization Code + PKCE (Keycloak)</p>
        <button onClick={() => auth.signinRedirect()}>Zaloguj przez Keycloak</button>
      </div>
    );
  }

  const username = whoami?.username ?? auth.user?.profile.preferred_username ?? '—';

  return (
    <>
      <header>
        <h1>Social Polyglot — SPA</h1>
        <div className="config">
          <span className="me">
            <b>{username}</b>
            {userId != null && <small> (app id: {userId})</small>}
          </span>
          <span className="roles">
            {roles.length ? (
              roles.map((r) => (
                <span key={r} className={`chip chip-${r.toLowerCase()}`}>
                  {r}
                </span>
              ))
            ) : (
              <span className="chip">brak ról</span>
            )}
          </span>
          <button className="danger" onClick={() => auth.signoutRedirect()}>
            Wyloguj
          </button>
        </div>
      </header>

      <main>
        {userId == null ? (
          <div className="panel">Mapowanie tożsamości (whoami)…</div>
        ) : (
          <>
            <Posts userId={userId} isPrivileged={isPrivileged} />
            <Feed userId={userId} />
            <Users />
            <Tags isAdmin={isAdmin} isModerator={isModerator} />
            <Notifications userId={userId} />
            <Stats userId={userId} />
            <Analytics />
            <GoogleCalendar />
            {isAdmin && <AdminPanel />}
          </>
        )}
      </main>
    </>
  );
}
