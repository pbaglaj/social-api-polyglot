import { useEffect, useState } from 'react';
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

// Spersonalizowany feed (mongo-service, paginacja kursorowa po insertedAt).
export function Feed({ userId }: { userId: number }) {
  const { request } = useApi();
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [limit, setLimit] = useState(10);
  const [status, setStatus] = useState('');

  async function load(append: boolean) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (append && cursor) params.set('cursor', cursor);
    setStatus('Loading…');
    try {
      const res = await request<FeedResponse | FeedEntry[]>(`/feed/${userId}?${params.toString()}`);
      const data = Array.isArray(res) ? res : (res?.data ?? []);
      const next = Array.isArray(res) ? null : (res?.nextCursor ?? null);
      setCursor(next);
      setEntries((prev) => (append ? [...prev, ...data] : data));
      setStatus(next ? 'Loaded. You can load the next page.' : 'Loaded (end).');
    } catch (e) {
      setStatus('Error: ' + (e as Error).message);
    }
  }

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <section className="card">
        <h2>Your feed</h2>
        <div className="row" style={{ marginBottom: 0 }}>
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
            Refresh feed
          </button>
          <button className="btn-primary" disabled={!cursor} onClick={() => void load(true)}>
            Next page
          </button>
        </div>
        {status && <div className="status">{status}</div>}
      </section>

      {entries.length === 0 ? (
        <div className="card empty-state">No feed entries.</div>
      ) : (
        entries.map((entry, i) => (
          <article key={`${entry.postId}-${i}`} className="post-card">
            <div className="post-meta">
              Post #{entry.postId} • score: {entry.score ?? '-'} •{' '}
              {entry.insertedAt ? new Date(entry.insertedAt).toLocaleString() : ''}
            </div>
            <div className="post-body">
              RichPost: {entry.richPost?.postId ? `#${entry.richPost.postId}` : 'none'} • attachments:{' '}
              {(entry.richPost?.attachments ?? []).length} • poll: {entry.richPost?.poll ? 'yes' : 'no'}
            </div>
          </article>
        ))
      )}
    </>
  );
}
