import { useNav, type View } from '../nav';

interface SidebarProps {
  isAdmin: boolean;
  userId: number | null;
}

const MAIN: { view: View; label: string }[] = [
  { view: 'home', label: 'Home' },
  { view: 'feed', label: 'Your feed' },
  { view: 'users', label: 'Users' },
];

const TOOLS: { view: View; label: string }[] = [
  { view: 'tags', label: 'Tags' },
  { view: 'notifications', label: 'Notifications' },
  { view: 'stats', label: 'Stats' },
  { view: 'analytics', label: 'Analytics' },
  { view: 'calendar', label: 'Google Calendar' },
];

// Lewa nawigacja app-shella. Kazda sekcja API ma tu swoje wejscie — SPA nadal
// wykorzystuje wszystkie endpointy (wymog projektu).
export function Sidebar({ isAdmin, userId }: SidebarProps) {
  const { view, goto, openProfile } = useNav();

  return (
    <aside className="sidebar">
      <nav className="nav-group">
        {MAIN.map((item) => (
          <button
            key={item.view}
            className={'nav-link' + (view === item.view ? ' active' : '')}
            onClick={() => goto(item.view)}
          >
            {item.label}
          </button>
        ))}
        <button
          className={'nav-link' + (view === 'profile' ? ' active' : '')}
          disabled={userId == null}
          onClick={() => userId != null && openProfile(userId)}
        >
          My profile
        </button>
      </nav>

      <nav className="nav-group">
        <div className="nav-group-title">Tools</div>
        {TOOLS.map((item) => (
          <button
            key={item.view}
            className={'nav-link' + (view === item.view ? ' active' : '')}
            onClick={() => goto(item.view)}
          >
            {item.label}
          </button>
        ))}
        {isAdmin && (
          <button
            className={'nav-link' + (view === 'admin' ? ' active' : '')}
            onClick={() => goto('admin')}
          >
            Admin panel
          </button>
        )}
      </nav>
    </aside>
  );
}
