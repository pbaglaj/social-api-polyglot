import { useState } from 'react';
import { useApi } from '../api';

interface FeedEntry {
  postId: number;
  score?: number;
  insertedAt?: string;
  richPost?: { postId?: number; attachments?: unknown[]; poll?: unknown };
}

interface FeedResponse {
  data?: FeedEntry[];
  nextCursor?: string | null;
}

export function Feed({ userId }: { userId: number }) {
  const { request } = useApi();
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [limit, setLimit] = useState(10);
  const [status, setStatus] = useState('');

  async function load(append: boolean) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (append && cursor) params.set('cursor', cursor);
    setStatus('Ładowanie…');
    try {
      const res = await request<FeedResponse | FeedEntry[]>(`/feed/${userId}?${params.toString()}`);
      const data = Array.isArray(res) ? res : (res?.data ?? []);
      const next = Array.isArray(res) ? null : (res?.nextCursor ?? null);
      setCursor(next);
      setEntries((prev) => (append ? [...prev, ...data] : data));
      setStatus(next ? 'Załadowano. Można pobrać kolejną stronę.' : 'Załadowano (koniec).');
    } catch (e) {
      setStatus('Błąd: ' + (e as Error).message);
    }
  }

  return (
    <section className="panel" id="feed">
      <h2>Feed (cursor pagination)</h2>
      <div className="row">
        <label>
          limit:
          <input type="number" value={limit} onChange={(e) => setLimit(parseInt(e.target.value, 10) || 10)} />
        </label>
        <button
          onClick={() => {
            setCursor(null);
            void load(false);
          }}
        >
          Załaduj feed
        </button>
        <button disabled={!cursor} onClick={() => void load(true)}>
          Następna strona
        </button>
      </div>
      {status && <div className="status">{status}</div>}
      <ul>
        {entries.length === 0 && <li className="empty">Brak wpisów w feedzie.</li>}
        {entries.map((entry, i) => (
          <li key={`${entry.postId}-${i}`} className="feed-entry">
            <div className="post-header">
              postId: {entry.postId} • score: {entry.score ?? '-'} •{' '}
              {entry.insertedAt ? new Date(entry.insertedAt).toLocaleString() : ''}
            </div>
            <div className="post-body">
              RichPost: {entry.richPost?.postId ? `#${entry.richPost.postId}` : 'brak'} • attachments:{' '}
              {(entry.richPost?.attachments ?? []).length} • poll: {entry.richPost?.poll ? 'tak' : 'nie'}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
