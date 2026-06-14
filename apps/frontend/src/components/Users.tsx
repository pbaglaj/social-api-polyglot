import { useEffect, useState } from 'react';
import { useApi } from '../api';
import { useNav } from '../nav';

interface User {
  id: number;
  username?: string;
  email?: string;
}

const PAGE = 10; // domyslnie widocznych userow (zad. 1)

export function Users() {
  const { request } = useApi();
  const { openProfile } = useNav();
  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [expanded, setExpanded] = useState(false);

  async function load() {
    const params = new URLSearchParams();
    if (username.trim()) params.set('username', username.trim());
    if (email.trim()) params.set('email', email.trim());
    const q = params.toString();
    try {
      const res = await request<{ users?: User[] } | User[]>('/users' + (q ? '?' + q : ''));
      const list = Array.isArray(res) ? res : (res?.users ?? []);
      setUsers(list);
      setExpanded(false);
    } catch (e) {
      setStatus('Loading error: ' + (e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function follow(id: number) {
    try {
      // followerId nadawany z tokenu po stronie backendu.
      await request(`/users/${id}/follow`, { method: 'POST', body: '{}' });
      setStatus(`You are now following user #${id}.`);
    } catch (e) {
      setStatus('Follow error: ' + (e as Error).message);
    }
  }

  async function unfollow(id: number) {
    try {
      await request(`/users/${id}/follow`, { method: 'DELETE', body: '{}' });
      setStatus(`You unfollowed user #${id}.`);
    } catch (e) {
      setStatus('Unfollow error: ' + (e as Error).message);
    }
  }

  const visible = expanded ? users : users.slice(0, PAGE);

  return (
    <section className="panel">
      <h2>Users</h2>
      <div className="row">
        <input placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button onClick={() => void load()}>Search</button>
      </div>
      {status && <div className="status">{status}</div>}

      <ul className="list">
        {users.length === 0 && <li className="empty">No users.</li>}
        {visible.map((u) => {
          const name = u.username ?? u.email ?? 'user';
          return (
            <li key={u.id} className="user-row">
              <div className="user-info">
                <button className="avatar" title={`Profile: ${name}`} onClick={() => openProfile(u.id)}>
                  {name[0]?.toUpperCase() ?? '?'}
                </button>
                <div className="user-text">
                  <div className="user-name">
                    <button className="link-btn" onClick={() => openProfile(u.id)}>
                      {name}
                    </button>{' '}
                    <span className="uid">#{u.id}</span>
                  </div>
                  {u.email && <div className="user-email">{u.email}</div>}
                </div>
              </div>
              <div className="user-actions">
                <button className="btn-primary" onClick={() => void follow(u.id)}>
                  Follow
                </button>
                <button onClick={() => void unfollow(u.id)}>Unfollow</button>
              </div>
            </li>
          );
        })}
      </ul>

      {users.length > PAGE && (
        <div className="expand-bar">
          <button onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Show less' : `Show more (all ${users.length})`}
          </button>
        </div>
      )}
    </section>
  );
}
