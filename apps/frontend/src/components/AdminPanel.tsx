import { useEffect, useState } from 'react';
import { useApi } from '../api';

interface KcUser {
  id: string;
  username?: string;
  email?: string;
  enabled?: boolean;
}

const ROLES = ['Admin', 'User', 'Moderator'];

export function AdminPanel() {
  const { request } = useApi();
  const [users, setUsers] = useState<KcUser[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  // create
  const [cu, setCu] = useState({ username: '', email: '', password: '', roles: ['User'] as string[] });

  async function load() {
    const q = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
    try {
      const res = await request<{ users?: KcUser[] }>('/admin/users' + q);
      setUsers(res?.users ?? []);
    } catch (e) {
      setStatus('Loading error: ' + (e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createUser() {
    if (!cu.username.trim() || !cu.email.includes('@') || cu.password.length < 4) {
      setStatus('Provide a username, a valid email and a password (min 4 chars).');
      return;
    }
    try {
      await request('/admin/users', { method: 'POST', body: JSON.stringify(cu) });
      setStatus(`Created user ${cu.username}.`);
      setCu({ username: '', email: '', password: '', roles: ['User'] });
      await load();
    } catch (e) {
      setStatus('Create error: ' + (e as Error).message);
    }
  }

  async function changeRole(id: string, role: string, grant: boolean) {
    try {
      await request(`/admin/users/${id}/roles`, {
        method: grant ? 'POST' : 'DELETE',
        body: JSON.stringify({ roles: [role] }),
      });
      setStatus(`${grant ? 'Granted' : 'Revoked'} role ${role}.`);
    } catch (e) {
      setStatus('Role error: ' + (e as Error).message);
    }
  }

  async function resetPassword(id: string) {
    const pwd = window.prompt('New password (min 4 chars):');
    if (!pwd || pwd.length < 4) return;
    try {
      await request(`/admin/users/${id}/password`, {
        method: 'PUT',
        body: JSON.stringify({ password: pwd, temporary: true }),
      });
      setStatus('Password reset (temporary).');
    } catch (e) {
      setStatus('Password reset error: ' + (e as Error).message);
    }
  }

  // Odzyskiwanie hasla (recovery) - deleguje do Keycloak: mail z linkiem resetu albo
  // wymagana akcja UPDATE_PASSWORD (gdy brak SMTP). Backend zwraca uzyty wariant.
  async function recoverPassword(id: string, username?: string) {
    if (!window.confirm(`Send password recovery for ${username ?? id}?`)) return;
    try {
      const res = await request<{ method?: string }>(`/admin/users/${id}/recover-password`, { method: 'POST' });
      const via = res?.method === 'email' ? 'reset email sent' : 'required action set (UPDATE_PASSWORD at next login)';
      setStatus(`Password recovery: ${via}.`);
    } catch (e) {
      setStatus('Recovery error: ' + (e as Error).message);
    }
  }

  // Wlaczenie 2FA/MFA (TOTP) - wymusza konfiguracje authenticatora przy logowaniu.
  async function enableMfa(id: string, username?: string) {
    if (!window.confirm(`Enable 2FA (TOTP) for ${username ?? id}?`)) return;
    try {
      const res = await request<{ emailed?: boolean }>(`/admin/users/${id}/mfa`, { method: 'POST' });
      setStatus(`2FA enabled: CONFIGURE_TOTP required at next login${res?.emailed ? ' (+ email sent)' : ''}.`);
    } catch (e) {
      setStatus('Enable 2FA error: ' + (e as Error).message);
    }
  }

  // Wylaczenie 2FA/MFA - usuwa skonfigurowane czynniki TOTP.
  async function disableMfa(id: string, username?: string) {
    if (!window.confirm(`Disable 2FA (TOTP) for ${username ?? id}?`)) return;
    try {
      const res = await request<{ removedFactors?: number }>(`/admin/users/${id}/mfa`, { method: 'DELETE' });
      setStatus(`2FA disabled (removed ${res?.removedFactors ?? 0} factor(s)).`);
    } catch (e) {
      setStatus('Disable 2FA error: ' + (e as Error).message);
    }
  }

  function toggleRole(role: string) {
    setCu((prev) => ({
      ...prev,
      roles: prev.roles.includes(role) ? prev.roles.filter((r) => r !== role) : [...prev.roles, role],
    }));
  }

  return (
    <section className="panel admin" id="admin">
      <h2>Admin panel (Keycloak Admin REST API)</h2>

      <div className="row">
        <input placeholder="search (username/email)" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button onClick={() => void load()}>Search</button>
      </div>

      <fieldset className="create-user">
        <legend>Create user</legend>
        <div className="row">
          <input placeholder="username" value={cu.username} onChange={(e) => setCu({ ...cu, username: e.target.value })} />
          <input placeholder="email" value={cu.email} onChange={(e) => setCu({ ...cu, email: e.target.value })} />
          <input
            type="password"
            placeholder="password"
            value={cu.password}
            onChange={(e) => setCu({ ...cu, password: e.target.value })}
          />
        </div>
        <div className="row">
          {ROLES.map((r) => (
            <label key={r}>
              <input type="checkbox" checked={cu.roles.includes(r)} onChange={() => toggleRole(r)} /> {r}
            </label>
          ))}
          <button onClick={() => void createUser()}>Create</button>
        </div>
      </fieldset>

      {status && <div className="status">{status}</div>}

      <ul>
        {users.length === 0 && <li className="empty">No users.</li>}
        {users.map((u) => (
          <li key={u.id} className="kc-user">
            <div>
              <b>{u.username}</b> <small>{u.email}</small> {u.enabled === false && <em>(disabled)</em>}
            </div>
            <div className="post-actions">
              {ROLES.map((r) => (
                <span key={r} className="role-controls">
                  <button onClick={() => void changeRole(u.id, r, true)}>+{r}</button>
                  <button className="danger" onClick={() => void changeRole(u.id, r, false)}>
                    −{r}
                  </button>
                </span>
              ))}
              <button onClick={() => void resetPassword(u.id)}>Reset password</button>
              <button onClick={() => void recoverPassword(u.id, u.username)}>Recover password</button>
              <button onClick={() => void enableMfa(u.id, u.username)}>Enable 2FA</button>
              <button className="danger" onClick={() => void disableMfa(u.id, u.username)}>
                Disable 2FA
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
