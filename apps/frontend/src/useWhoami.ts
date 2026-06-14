import { useEffect, useState } from 'react';
import { useApi } from './api';

export interface Whoami {
  authenticated: boolean;
  keycloakId: string | null;
  username: string | null;
  email: string | null;
  roles: string[];
  appUser: { id: number; keycloakId: string; username: string; roles: string[] } | null;
}

// Po zalogowaniu pobiera tozsamosc z GET /admin/me. appUser.id to int-id uzywany przez
// relacyjne endpointy (feed/:userId, stats/user/:id, notifications/:userId).
export function useWhoami(ready: boolean) {
  const { request } = useApi();
  const [whoami, setWhoami] = useState<Whoami | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    request<Whoami>('/admin/me')
      .then((data) => {
        if (!cancelled) setWhoami(data);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, request]);

  const roles = whoami?.roles ?? [];
  return {
    whoami,
    error,
    userId: whoami?.appUser?.id ?? null,
    roles,
    isAdmin: roles.includes('Admin'),
    isModerator: roles.includes('Moderator'),
    isPrivileged: roles.includes('Admin') || roles.includes('Moderator'),
  };
}
