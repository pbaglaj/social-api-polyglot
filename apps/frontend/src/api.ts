import { useAuth } from 'react-oidc-context';
import { useCallback } from 'react';
import { API_BASE } from './config';

export interface ApiError extends Error {
  status: number;
  code?: string;
}

// Hook zwracajacy funkcje `request`, ktora dokleja Bearer token z aktualnej sesji OIDC
// i ujednolica obsluge bledow (kontrakt backendu: { error, code, details }).
export function useApi() {
  const auth = useAuth();
  const token = auth.user?.access_token;

  const request = useCallback(
    async <T = unknown>(path: string, opts: RequestInit = {}): Promise<T | null> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(opts.headers as Record<string, string> | undefined),
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(API_BASE + path, { ...opts, headers });

      if (!res.ok) {
        let message = res.statusText;
        let code: string | undefined;
        try {
          const body = await res.json();
          message = body.details || body.error || message;
          code = body.code;
        } catch {
          /* odpowiedz bez JSON - zostaje statusText */
        }
        const err = new Error(message) as ApiError;
        err.status = res.status;
        err.code = code;
        throw err;
      }

      if (res.status === 204) return null;
      return (await res.json().catch(() => null)) as T | null;
    },
    [token],
  );

  return { request };
}
