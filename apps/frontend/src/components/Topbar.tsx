import { useNav } from '../nav';

interface TopbarProps {
  username: string;
  roles: string[];
  appUserId: number | null;
  onLogout: () => void;
}

// Gorny pasek: logo (-> Home), role usera, awatar (-> wlasny profil), wyloguj.
export function Topbar({ username, roles, appUserId, onLogout }: TopbarProps) {
  const { goto, openProfile } = useNav();
  const initial = (username?.[0] ?? '?').toUpperCase();

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button className="brand" onClick={() => goto('home')} title="Home">
          <span className="brand-mark">S</span>
          <span className="brand-name">Social</span>
        </button>

        <div className="topbar-right">
          <span className="roles">
            {roles.length ? (
              roles.map((r) => (
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
