import { useEffect, useState } from 'react';
import { useApi } from '../api';

interface Post {
  id: number;
  authorId: number;
  bodyPreview: string;
  author?: { username?: string };
  _count?: { reactions?: number };
}

interface Comment {
  id: number;
  authorId: number;
  content: string;
  parentId: number | null;
  author?: { username?: string };
}

const REACTIONS = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];

export function Posts({ userId, isPrivileged }: { userId: number; isPrivileged: boolean }) {
  const { request } = useApi();
  const [posts, setPosts] = useState<Post[]>([]);
  const [status, setStatus] = useState('');
  const [filterAuthor, setFilterAuthor] = useState('');
  const [filterHashtag, setFilterHashtag] = useState('');
  const [newBody, setNewBody] = useState('');
  const [reactionType, setReactionType] = useState('like');
  const [openComments, setOpenComments] = useState<number | null>(null);

  async function load() {
    const params = new URLSearchParams();
    if (filterAuthor.trim()) params.set('authorId', filterAuthor.trim());
    if (filterHashtag.trim()) params.set('hashtag', filterHashtag.trim());
    const q = params.toString();
    try {
      const data = await request<Post[]>('/posts' + (q ? '?' + q : ''));
      setPosts(data ?? []);
    } catch (e) {
      setStatus('Błąd ładowania: ' + (e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createPost() {
    if (!newBody.trim()) return;
    setStatus('Wysyłanie…');
    try {
      // authorId nadawany jest po stronie backendu z tokenu (req.appUser.id).
      await request('/posts', { method: 'POST', body: JSON.stringify({ bodyPreview: newBody }) });
      setNewBody('');
      setStatus('Utworzono post.');
      await load();
    } catch (e) {
      setStatus('Błąd: ' + (e as Error).message);
    }
  }

  async function react(id: number) {
    try {
      await request(`/posts/${id}/reactions`, { method: 'POST', body: JSON.stringify({ type: reactionType }) });
      await load();
    } catch (e) {
      setStatus('Błąd reakcji: ' + (e as Error).message);
    }
  }

  async function remove(id: number) {
    if (!window.confirm('Usunąć ten post?')) return;
    try {
      await request(`/posts/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setStatus('Błąd usuwania: ' + (e as Error).message);
    }
  }

  return (
    <section className="panel" id="posts">
      <h2>Posty</h2>

      <div className="row">
        <input placeholder="authorId" value={filterAuthor} onChange={(e) => setFilterAuthor(e.target.value)} />
        <input placeholder="hashtag / fragment" value={filterHashtag} onChange={(e) => setFilterHashtag(e.target.value)} />
        <button onClick={() => void load()}>Filtruj</button>
      </div>

      <div className="row">
        <input className="grow" placeholder="Treść posta…" value={newBody} onChange={(e) => setNewBody(e.target.value)} />
        <button onClick={() => void createPost()}>Dodaj post</button>
        <label>
          reakcja:
          <select value={reactionType} onChange={(e) => setReactionType(e.target.value)}>
            {REACTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>
      {status && <div className="status">{status}</div>}

      <ul>
        {posts.length === 0 && <li className="empty">Brak postów.</li>}
        {posts.map((p) => {
          const canDelete = isPrivileged || p.authorId === userId;
          return (
            <li key={p.id} className="post">
              <div className="post-header">
                {p.author?.username ?? `user-${p.authorId}`} • author ID: {p.authorId} • Post #{p.id}
              </div>
              <div className="post-body">{p.bodyPreview}</div>
              <div className="post-actions">
                <button onClick={() => void react(p.id)}>React ({p._count?.reactions ?? 0})</button>
                <button onClick={() => setOpenComments(openComments === p.id ? null : p.id)}>
                  {openComments === p.id ? 'Ukryj komentarze' : 'Komentarze'}
                </button>
                {canDelete && (
                  <button className="danger" onClick={() => void remove(p.id)}>
                    Usuń
                  </button>
                )}
              </div>
              {openComments === p.id && <CommentsPanel postId={p.id} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CommentsPanel({ postId }: { postId: number }) {
  const { request } = useApi();
  const [comments, setComments] = useState<Comment[]>([]);
  const [content, setContent] = useState('');
  const [parentId, setParentId] = useState('');
  const [status, setStatus] = useState('');

  async function load() {
    try {
      const data = await request<Comment[]>(`/posts/${postId}/comments`);
      setComments(data ?? []);
    } catch (e) {
      setStatus('Błąd: ' + (e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  async function add() {
    if (!content.trim()) return;
    const payload: Record<string, unknown> = { content };
    if (parentId.trim()) payload.parentId = parseInt(parentId, 10);
    try {
      await request(`/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify(payload) });
      setContent('');
      setParentId('');
      await load();
    } catch (e) {
      setStatus('Błąd dodawania: ' + (e as Error).message);
    }
  }

  // Renderowanie wątku po parentId.
  const byParent = new Map<string, Comment[]>();
  comments.forEach((c) => {
    const key = c.parentId == null ? 'root' : String(c.parentId);
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  });

  const renderLevel = (key: string, depth: number): JSX.Element[] => {
    return (byParent.get(key) ?? []).map((c) => (
      <li key={c.id} className={`comment-item depth-${Math.min(depth, 4)}`}>
        <div className="comment-meta">
          {c.author?.username ?? `user-${c.authorId}`} • author ID: {c.authorId} • Komentarz #{c.id}
        </div>
        <div className="comment-content">{c.content}</div>
        {byParent.has(String(c.id)) && <ul className="comment-children">{renderLevel(String(c.id), depth + 1)}</ul>}
      </li>
    ));
  };

  return (
    <div className="comments-panel">
      <ul className="comments-list">
        {comments.length === 0 ? <li className="comment-empty">Brak komentarzy.</li> : renderLevel('root', 0)}
      </ul>
      <div className="comment-form">
        <input placeholder="Napisz komentarz…" value={content} onChange={(e) => setContent(e.target.value)} />
        <input type="number" placeholder="parentId (opcj.)" value={parentId} onChange={(e) => setParentId(e.target.value)} />
        <button onClick={() => void add()}>Dodaj</button>
      </div>
      {status && <div className="status">{status}</div>}
    </div>
  );
}
