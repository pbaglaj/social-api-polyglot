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
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
