// Klient Keycloak Admin REST API uzywany przez backend (pg-service) do
// zarzadzania uzytkownikami: zakladanie konta, przypisywanie rol, reset hasla.
// Backend uwierzytelnia sie wlasnym poufnym klientem (backend-admin) flow'em
// Client Credentials - bez udzialu czlowieka, z minimalnymi uprawnieniami
// (realm-management: manage-users/view-users).

const KC_URL = process.env.KEYCLOAK_INTERNAL_URL || 'http://keycloak:8080';
const REALM = process.env.KEYCLOAK_REALM || 'SocialPolyglot';
const CLIENT_ID = process.env.KC_ADMIN_CLIENT_ID || 'backend-admin';
const CLIENT_SECRET = process.env.KC_ADMIN_CLIENT_SECRET || '';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}
let cached: CachedToken | null = null;

async function getAdminToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 5_000) return cached.accessToken;

  const res = await fetch(`${KC_URL}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    throw new Error(`Keycloak token error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function kcFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAdminToken();
  return fetch(`${KC_URL}/admin/realms/${REALM}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

export interface NewUserInput {
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  password: string;
  temporary?: boolean;
  roles?: string[];
}

export async function listUsers(search?: string) {
  const qs = search ? `?search=${encodeURIComponent(search)}&max=50` : '?max=50';
  const res = await kcFetch(`/users${qs}`);
  if (!res.ok) throw new Error(`Keycloak listUsers ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function createUser(input: NewUserInput): Promise<{ id: string }> {
  const res = await kcFetch('/users', {
    method: 'POST',
    body: JSON.stringify({
      username: input.username,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      enabled: true,
      emailVerified: true,
      credentials: [{ type: 'password', value: input.password, temporary: input.temporary ?? false }],
    }),
  });
  if (res.status !== 201) {
    throw new Error(`Keycloak createUser ${res.status}: ${await res.text()}`);
  }
  // Keycloak zwraca Location: .../users/{id}
  const location = res.headers.get('location') || '';
  const id = location.split('/').pop() || '';

  if (input.roles?.length) {
    await assignRealmRoles(id, input.roles);
  }
  return { id };
}

async function getRealmRole(roleName: string): Promise<{ id: string; name: string }> {
  const res = await kcFetch(`/roles/${encodeURIComponent(roleName)}`);
  if (!res.ok) throw new Error(`Keycloak getRole '${roleName}' ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function assignRealmRoles(userId: string, roleNames: string[]): Promise<void> {
  const roles = await Promise.all(roleNames.map(getRealmRole));
  const res = await kcFetch(`/users/${userId}/role-mappings/realm`, {
    method: 'POST',
    body: JSON.stringify(roles.map((r) => ({ id: r.id, name: r.name }))),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Keycloak assignRoles ${res.status}: ${await res.text()}`);
  }
}

export async function removeRealmRoles(userId: string, roleNames: string[]): Promise<void> {
  const roles = await Promise.all(roleNames.map(getRealmRole));
  const res = await kcFetch(`/users/${userId}/role-mappings/realm`, {
    method: 'DELETE',
    body: JSON.stringify(roles.map((r) => ({ id: r.id, name: r.name }))),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Keycloak removeRoles ${res.status}: ${await res.text()}`);
  }
}

export async function resetPassword(userId: string, password: string, temporary = true): Promise<void> {
  const res = await kcFetch(`/users/${userId}/reset-password`, {
    method: 'PUT',
    body: JSON.stringify({ type: 'password', value: password, temporary }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Keycloak resetPassword ${res.status}: ${await res.text()}`);
  }
}

interface KcUser {
  id: string;
  username: string;
  email?: string;
  requiredActions?: string[];
}

export async function getUser(userId: string): Promise<KcUser> {
  const res = await kcFetch(`/users/${userId}`);
  if (!res.ok) throw new Error(`Keycloak getUser ${res.status}: ${await res.text()}`);
  return res.json() as Promise<KcUser>;
}

// Dopisuje wymagane akcje (UPDATE_PASSWORD, CONFIGURE_TOTP, ...) do konta - uzytkownik
// musi je wykonac przy najblizszym logowaniu. Dziala bez SMTP, w przeciwienstwie do maili.
export async function addRequiredActions(userId: string, actions: string[]): Promise<void> {
  const user = await getUser(userId);
  const merged = Array.from(new Set([...(user.requiredActions ?? []), ...actions]));
  const res = await kcFetch(`/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ requiredActions: merged }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Keycloak addRequiredActions ${res.status}: ${await res.text()}`);
  }
}

export async function removeRequiredActions(userId: string, actions: string[]): Promise<void> {
  const user = await getUser(userId);
  const remaining = (user.requiredActions ?? []).filter((a) => !actions.includes(a));
  const res = await kcFetch(`/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ requiredActions: remaining }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Keycloak removeRequiredActions ${res.status}: ${await res.text()}`);
  }
}

// Wysyla maila z linkiem do wykonania akcji (UPDATE_PASSWORD = odzyskiwanie hasla,
// CONFIGURE_TOTP = konfiguracja 2FA). Wymaga skonfigurowanego SMTP w realmie -
// w przeciwnym razie Keycloak zwraca blad i nalezy uzyc addRequiredActions().
export async function sendExecuteActionsEmail(userId: string, actions: string[]): Promise<void> {
  const res = await kcFetch(`/users/${userId}/execute-actions-email`, {
    method: 'PUT',
    body: JSON.stringify(actions),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Keycloak executeActionsEmail ${res.status}: ${await res.text()}`);
  }
}

interface KcCredential {
  id: string;
  type: string;
}

export async function listCredentials(userId: string): Promise<KcCredential[]> {
  const res = await kcFetch(`/users/${userId}/credentials`);
  if (!res.ok) throw new Error(`Keycloak listCredentials ${res.status}: ${await res.text()}`);
  return res.json() as Promise<KcCredential[]>;
}

// Usuwa wszystkie skonfigurowane czynniki TOTP/OTP - wylacza 2FA dla konta.
// Zwraca liczbe usunietych poswiadczen.
export async function deleteOtpCredentials(userId: string): Promise<number> {
  const creds = await listCredentials(userId);
  const otp = creds.filter((c) => c.type === 'otp');
  for (const c of otp) {
    const res = await kcFetch(`/users/${userId}/credentials/${c.id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Keycloak deleteCredential ${res.status}: ${await res.text()}`);
    }
  }
  return otp.length;
}
