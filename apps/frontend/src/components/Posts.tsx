import { useEffect, useState } from 'react';
import { useApi } from '../api';
import { PostCard, type Post } from './PostCard';

const PAGE = 10; // domyslnie widocznych postow (zad. 1)

export function Posts({ userId, isPrivileged }: { userId: number; isPrivileged: boolean }) {
  const { request } = useApi();
  const [posts, setPosts] = useState<Post[]>([]);
  const [status, setStatus] = useState('');
  const [filterAuthor, setFilterAuthor] = useState('');
  const [filterHashtag, setFilterHashtag] = useState('');
  const [newBody, setNewBody] = useState('');
  const [expanded, setExpanded] = useState(false);

  async function load() {
    const params = new URLSearchParams();
    if (filterAuthor.trim()) params.set('authorId', filterAuthor.trim());
    if (filterHashtag.trim()) params.set('hashtag', filterHashtag.trim());
    const q = params.toString();
    try {
      const data = await request<Post[]>('/posts' + (q ? '?' + q : ''));
      setPosts(data ?? []);
      setExpanded(false);
    } catch (e) {
      setStatus('Loading error: ' + (e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createPost() {
    if (!newBody.trim()) return;
    setStatus('Publishing…');
    try {
      // authorId nadawany jest po stronie backendu z tokenu (req.appUser.id).
      await request('/posts', { method: 'POST', body: JSON.stringify({ bodyPreview: newBody }) });
      setNewBody('');
      setStatus('Post published.');
      await load();
    } catch (e) {
      setStatus('Error: ' + (e as Error).message);
    }
  }

  const visible = expanded ? posts : posts.slice(0, PAGE);

  return (
    <>
      {/* Composer — tworzenie posta */}
      <section className="card composer">
        <div className="composer-top">
          <textarea
            placeholder="What's on your mind? Write a post…"
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
          />
        </div>
        <div className="composer-actions">
          {status && <span className="status">{status}</span>}
          <button className="btn-primary" disabled={!newBody.trim()} onClick={() => void createPost()}>
            Post
          </button>
        </div>
      </section>

      {/* Filtry */}
      <section className="card">
        <div className="row" style={{ marginBottom: 0 }}>
          <input placeholder="authorId" value={filterAuthor} onChange={(e) => setFilterAuthor(e.target.value)} />
          <input placeholder="hashtag / text" value={filterHashtag} onChange={(e) => setFilterHashtag(e.target.value)} />
          <button onClick={() => void load()}>Filter</button>
        </div>
      </section>

      {/* Lista postow (karty) */}
      {posts.length === 0 ? (
        <div className="card empty-state">No posts.</div>
      ) : (
        <>
          {visible.map((p) => (
            <PostCard key={p.id} post={p} currentUserId={userId} isPrivileged={isPrivileged} onChanged={() => void load()} />
          ))}
          {posts.length > PAGE && (
            <div className="expand-bar">
              <button onClick={() => setExpanded((v) => !v)}>
                {expanded ? 'Show less' : `Show more (all ${posts.length})`}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
