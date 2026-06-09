import { useMemo, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { useWhoami } from './useWhoami';
import { NavContext, type NavApi, type View } from './nav';
import { Topbar } from './components/Topbar';
import { Sidebar } from './components/Sidebar';
import { Posts } from './components/Posts';
import { Users } from './components/Users';
import { Feed } from './components/Feed';
import { Profile } from './components/Profile';
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

  const [view, setView] = useState<View>('home');
  const [profileUserId, setProfileUserId] = useState<number | null>(null);

  const nav: NavApi = useMemo(
    () => ({
      view,
      profileUserId,
      goto: (v) => setView(v),
      openProfile: (id) => {
        setProfileUserId(id);
        setView('profile');
      },
    }),
    [view, profileUserId],
  );

  if (auth.isLoading) {
    return <div className="centered">Loading session…</div>;
  }

  if (auth.error) {
    return (
      <div className="centered">
        <div className="login-card">
          <div className="brand-mark">S</div>
          <h1>Login error</h1>
          <p>{auth.error.message}</p>
          <button className="btn-primary" onClick={() => auth.signinRedirect()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <div className="centered">
        <div className="login-card">
          <div className="brand-mark">S</div>
          <h1>Social Polyglot</h1>
          <p>SPA client — OAuth2 Authorization Code + PKCE (Keycloak)</p>
          <button className="btn-primary" onClick={() => auth.signinRedirect()}>
            Sign in with Keycloak
          </button>
        </div>
      </div>
    );
  }

  const username = whoami?.username ?? auth.user?.profile.preferred_username ?? '—';

  function renderView() {
    if (userId == null) {
      return <div className="card empty-state">Mapping identity (whoami)…</div>;
    }
    switch (view) {
      case 'home':
        return <Posts userId={userId} isPrivileged={isPrivileged} />;
      case 'feed':
        return <Feed userId={userId} />;
      case 'profile':
        return <Profile selfId={userId} isPrivileged={isPrivileged} />;
      case 'users':
        return <Users />;
      case 'tags':
        return <Tags isAdmin={isAdmin} isModerator={isModerator} />;
      case 'notifications':
        return <Notifications userId={userId} />;
      case 'stats':
        return <Stats userId={userId} />;
      case 'analytics':
        return <Analytics />;
      case 'calendar':
        return <GoogleCalendar />;
      case 'admin':
        return isAdmin ? <AdminPanel /> : <div className="card empty-state">No permission.</div>;
      default:
        return null;
    }
  }

  return (
    <NavContext.Provider value={nav}>
      <div className="app-shell">
        <Topbar username={username} roles={roles} appUserId={userId} onLogout={() => auth.signoutRedirect()} />
        <div className="layout">
          <Sidebar isAdmin={isAdmin} userId={userId} />
          <main className="content">{renderView()}</main>
        </div>
      </div>
    </NavContext.Provider>
  );
}
