import { useNav } from '../nav';

interface TopbarProps {
  username: string;
  roles: string[];
  appUserId: number | null;
  onLogout: () => void;
}

// Znaczace role aplikacji — domyslne role Keycloak (offline_access,
// uma_authorization, default-roles-*) sa pomijane w naglowku.
const APP_ROLES = ['Admin', 'Moderator', 'User', 'analytics'];

// Gorny pasek: logo (-> Home), role usera, awatar (-> wlasny profil), wyloguj.
export function Topbar({ username, roles, appUserId, onLogout }: TopbarProps) {
  const { goto, openProfile } = useNav();
  const initial = (username?.[0] ?? '?').toUpperCase();
  const shownRoles = roles.filter((r) => APP_ROLES.includes(r));

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button className="brand" onClick={() => goto('home')} title="Home">
          <span className="brand-mark">S</span>
          <span className="brand-name">Social</span>
        </button>

        <div className="topbar-right">
          <span className="roles">
            {shownRoles.length ? (
              shownRoles.map((r) => (
                <span key={r} className={`chip chip-${r.toLowerCase()}`}>
                  {r}
                </span>
              ))
            ) : (
              <span className="chip">no roles</span>
            )}
          </span>

          <button
            className="avatar-btn"
            title="My profile"
            disabled={appUserId == null}
            onClick={() => appUserId != null && openProfile(appUserId)}
          >
            <span className="avatar">{initial}</span>
            <span className="avatar-name">{username}</span>
          </button>

          <button className="btn-ghost" onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
