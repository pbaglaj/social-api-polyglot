import { useEffect, useState } from 'react';
import { useApi } from '../api';
import { useNav } from '../nav';

export interface Post {
  id: number;
  authorId: number;
  bodyPreview: string;
  createdAt?: string;
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

export const REACTIONS = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];

// Pojedyncza karta posta. Wspoldzielona przez Home i Profile.
export function PostCard({
  post,
  currentUserId,
  isPrivileged,
  onChanged,
}: {
  post: Post;
  currentUserId: number;
  isPrivileged: boolean;
  onChanged: () => void;
}) {
  const { request } = useApi();
  const { openProfile } = useNav();
  const [reactionType, setReactionType] = useState('like');
  const [openComments, setOpenComments] = useState(false);
  const [status, setStatus] = useState('');

  const authorName = post.author?.username ?? `user-${post.authorId}`;
  const canDelete = isPrivileged || post.authorId === currentUserId;

  async function react() {
    try {
      await request(`/posts/${post.id}/reactions`, { method: 'POST', body: JSON.stringify({ type: reactionType }) });
      onChanged();
    } catch (e) {
      setStatus('Reaction error: ' + (e as Error).message);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this post?')) return;
    try {
      await request(`/posts/${post.id}`, { method: 'DELETE' });
      onChanged();
    } catch (e) {
      setStatus('Delete error: ' + (e as Error).message);
    }
  }

  return (
    <article className="post-card">
      <div className="post-card-head">
        <button className="avatar" title={`Profile: ${authorName}`} onClick={() => openProfile(post.authorId)}>
          {authorName[0]?.toUpperCase() ?? '?'}
        </button>
        <div>
          <button className="link-btn post-author" onClick={() => openProfile(post.authorId)}>
            {authorName}
          </button>
          <div className="post-meta">
            #{post.id} {post.createdAt ? `• ${new Date(post.createdAt).toLocaleString()}` : ''}
          </div>
        </div>
      </div>

      <div className="post-body">{post.bodyPreview}</div>

      <div className="post-stats">{post._count?.reactions ?? 0} reactions</div>

      <div className="post-actions">
        <button onClick={() => void react()}>React</button>
        <button onClick={() => setOpenComments((v) => !v)}>
          {openComments ? 'Hide comments' : 'Comments'}
        </button>
        {canDelete && (
          <button className="danger" onClick={() => void remove()}>
            Delete
          </button>
        )}
        <select
          className="reaction-select"
          value={reactionType}
          onChange={(e) => setReactionType(e.target.value)}
          title="Reaction type"
        >
          {REACTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {status && <div className="status">{status}</div>}
      {openComments && <CommentsPanel postId={post.id} />}
    </article>
  );
}

export function CommentsPanel({ postId }: { postId: number }) {
  const { request } = useApi();
  const { openProfile } = useNav();
  const [comments, setComments] = useState<Comment[]>([]);
  const [content, setContent] = useState('');
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [status, setStatus] = useState('');

  async function load() {
    try {
      const data = await request<Comment[]>(`/posts/${postId}/comments`);
      setComments(data ?? []);
    } catch (e) {
      setStatus('Error: ' + (e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  async function add() {
    if (!content.trim()) return;
    const payload: Record<string, unknown> = { content };
    // parentId dolaczamy tylko gdy odpowiadamy na konkretny komentarz (przycisk "Reply").
    if (replyTo != null) payload.parentId = replyTo;
    try {
      await request(`/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify(payload) });
      setContent('');
      setReplyTo(null);
      await load();
    } catch (e) {
      setStatus('Add error: ' + (e as Error).message);
    }
  }

  // Renderowanie watku po parentId.
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
          <button className="link-btn" onClick={() => openProfile(c.authorId)}>
            {c.author?.username ?? `user-${c.authorId}`}
          </button>{' '}
          • Comment #{c.id}
        </div>
        <div className="comment-content">{c.content}</div>
        <div className="comment-actions">
          <button className="link-btn" onClick={() => setReplyTo(c.id)}>
            Reply
          </button>
        </div>
        {byParent.has(String(c.id)) && <ul className="comment-children">{renderLevel(String(c.id), depth + 1)}</ul>}
      </li>
    ));
  };

  const replyTarget = replyTo != null ? comments.find((c) => c.id === replyTo) : null;

  return (
    <div className="comments-panel">
      <ul className="comments-list">
        {comments.length === 0 ? <li className="comment-empty">No comments.</li> : renderLevel('root', 0)}
      </ul>
      <div className="comment-form">
        {replyTo != null && (
          <div className="reply-banner">
            <span>
              Replying to {replyTarget?.author?.username ?? `user-${replyTarget?.authorId ?? ''}`} (comment #{replyTo})
            </span>
            <button className="link-btn" onClick={() => setReplyTo(null)}>
              Cancel
            </button>
          </div>
        )}
        <input
          placeholder={replyTo != null ? 'Write a reply…' : 'Write a comment…'}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        <button className="btn-primary" onClick={() => void add()}>
          {replyTo != null ? 'Reply' : 'Add'}
        </button>
      </div>
      {status && <div className="status">{status}</div>}
    </div>
  );
}
