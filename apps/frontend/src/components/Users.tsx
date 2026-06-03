import { useEffect, useState } from 'react';
import { useApi } from '../api';

interface User {
  id: number;
  username?: string;
  email?: string;
}

export function Users() {
  const { request } = useApi();
  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');

  async function load() {
    const params = new URLSearchParams();
    if (username.trim()) params.set('username', username.trim());
    if (email.trim()) params.set('email', email.trim());
    const q = params.toString();
    try {
      const res = await request<{ users?: User[] } | User[]>('/users' + (q ? '?' + q : ''));
      const list = Array.isArray(res) ? res : (res?.users ?? []);
      setUsers(list);
    } catch (e) {
      setStatus('Błąd ładowania: ' + (e as Error).message);
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
      setStatus(`Obserwujesz użytkownika #${id}.`);
    } catch (e) {
      setStatus('Błąd follow: ' + (e as Error).message);
    }
  }

  async function unfollow(id: number) {
    try {
      await request(`/users/${id}/follow`, { method: 'DELETE', body: '{}' });
      setStatus(`Przestałeś obserwować #${id}.`);
    } catch (e) {
      setStatus('Błąd unfollow: ' + (e as Error).message);
    }
  }

  return (
    <section className="panel">
      <h2>Użytkownicy</h2>
      <div className="row">
        <input placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button onClick={() => void load()}>Szukaj</button>
      </div>
      {status && <div className="status">{status}</div>}
      <ul id="users">
        {users.length === 0 && <li className="empty">Brak użytkowników.</li>}
        {users.map((u) => (
          <li key={u.id}>
            <span>
              <b>#{u.id}</b> {u.username ?? u.email ?? 'user'} <small>{u.email ?? ''}</small>
            </span>
            <button onClick={() => void follow(u.id)}>Follow</button>
            <button className="danger" onClick={() => void unfollow(u.id)}>
              Unfollow
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
