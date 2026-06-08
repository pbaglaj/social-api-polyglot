import { createContext, useContext } from 'react';

// Widoki app-shella. Brak react-router (SPA jednoplikowa) — prosty przelacznik
// widokow w stanie App + kontekst do nawigacji z dowolnego komponentu.
export type View =
  | 'home'
  | 'feed'
  | 'profile'
  | 'users'
  | 'tags'
  | 'notifications'
  | 'stats'
  | 'analytics'
  | 'calendar'
  | 'admin';

export interface NavApi {
  view: View;
  /** id usera, ktorego profil ogladamy (null => wlasny). */
  profileUserId: number | null;
  goto: (view: View) => void;
  /** otwiera profil wskazanego usera (klik w usera w listach/postach — zad. 2). */
  openProfile: (userId: number) => void;
}

export const NavContext = createContext<NavApi | null>(null);

export function useNav(): NavApi {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav musi byc uzyte wewnatrz <NavContext.Provider>.');
  return ctx;
}
