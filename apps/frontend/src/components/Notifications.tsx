import { useEffect, useState } from 'react';
import { useApi } from '../api';

interface Notification {
  id: number;
  message: string;
  isRead: boolean;
  createdAt?: string;
  type?: { name?: string; icon?: string };
}

const TYPES = ['new_post', 'new_follower', 'reaction', 'comment', 'system'];

export function Notifications({ userId }: { userId: number }) {
  const { request } = useApi();
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [status, setStatus] = useState('');
  const [newType, setNewType] = useState('system');
  const [newMessage, setNewMessage] = useState('');

  async function load() {
    const params = new URLSearchParams();
    if (unreadOnly) params.set('unread', 'true');
    try {
      const res = await request<{ notifications?: Notification[] }>(`/notifications/${userId}?${params.toString()}`);
      setItems(res?.notifications ?? []);
    } catch (e) {
      setStatus('Błąd: ' + (e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadOnly]);

  async function remove(id: number) {
    try {
      await request(`/notifications/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setStatus('Błąd usuwania: ' + (e as Error).message);
    }
  }

  async function markAllRead() {
    try {
      const res = await request<{ markedAsRead?: number }>(`/notifications/${userId}/read-all`, { method: 'PATCH' });
      setStatus(`Oznaczono ${res?.markedAsRead ?? 0} powiadomień.`);
      await load();
    } catch (e) {
      setStatus('Błąd: ' + (e as Error).message);
    }
  }

  async function create() {
    if (!newMessage.trim()) return;
    try {
      await request('/notifications', {
        method: 'POST',
        body: JSON.stringify({ userId, typeName: newType, message: newMessage.trim() }),
      });
      setNewMessage('');
      setStatus('Utworzono powiadomienie.');
      await load();
    } catch (e) {
      setStatus('Błąd: ' + (e as Error).message);
    }
  }

  return (
    <section className="panel" id="notifications">
      <h2>Powiadomienia (Sequelize)</h2>
      <div className="controls">
        <label>
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> tylko nieprzeczytane
        </label>
        <button onClick={() => void load()}>Odśwież</button>
        <button onClick={() => void markAllRead()}>Oznacz wszystkie jako przeczytane</button>
      </div>
      <div className="row">
        <select value={newType} onChange={(e) => setNewType(e.target.value)}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input className="grow" placeholder="treść powiadomienia" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} />
        <button onClick={() => void create()}>Utwórz</button>
      </div>
      {status && <div className="status">{status}</div>}
      <ul>
        {items.length === 0 && <li className="empty">Brak powiadomień.</li>}
        {items.map((n) => (
          <li key={n.id} className={'notification-item' + (n.isRead ? ' is-read' : '')}>
            <div className="notif-header">
              {n.type?.icon ?? ''} <b>{n.type?.name ?? '?'}</b>{' '}
              <small>
                • {n.createdAt ? new Date(n.createdAt).toLocaleString() : ''} {n.isRead ? '• przeczytane' : '• NOWE'}
              </small>
            </div>
            <div className="notif-body">{n.message}</div>
            <button className="danger delete-notif" onClick={() => void remove(n.id)}>
              Usuń
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
