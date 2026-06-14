import { useEffect, useState } from 'react';
import { useApi } from '../api';

interface Tag {
  id?: number;
  name: string;
  description?: string;
  usageCount?: number;
}

export function Tags({ isAdmin, isModerator }: { isAdmin: boolean; isModerator: boolean }) {
  const { request } = useApi();
  const [tags, setTags] = useState<Tag[]>([]);
  const [status, setStatus] = useState('');
  const [name, setName] = useState('');
  const [sortBy, setSortBy] = useState('usageCount');
  const [order, setOrder] = useState('desc');
  // create (Admin)
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  // attach (Admin/Moderator)
  const [attachPostId, setAttachPostId] = useState('');
  const [attachTag, setAttachTag] = useState('');

  async function load() {
    const params = new URLSearchParams({ sortBy, order });
    if (name.trim()) params.set('name', name.trim());
    try {
      const res = await request<{ tags?: Tag[] }>(`/tags?${params.toString()}`);
      setTags(res?.tags ?? []);
    } catch (e) {
      setStatus('Loading error: ' + (e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function showPosts(tag: string) {
    try {
      const res = await request<{ count: number; posts: { id: number; authorId: number; bodyPreview: string }[] }>(
        `/tags/${encodeURIComponent(tag)}/posts`,
      );
      alert(
        `#${tag} — posts: ${res?.count ?? 0}\n\n` +
          (res?.posts ?? []).map((p) => `#${p.id} (author ${p.authorId}): ${p.bodyPreview}`).join('\n'),
      );
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    }
  }

  async function createTag() {
    if (!newName.trim()) return;
    try {
      await request('/tags', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined }),
      });
      setNewName('');
      setNewDesc('');
      setStatus('Tag created.');
      await load();
    } catch (e) {
      setStatus('Create error: ' + (e as Error).message);
    }
  }

  async function attach() {
    if (!attachPostId.trim() || !attachTag.trim()) return;
    try {
      await request('/tags/attach', {
        method: 'POST',
        body: JSON.stringify({ postId: parseInt(attachPostId, 10), tagName: attachTag.trim() }),
      });
      setAttachPostId('');
      setAttachTag('');
      setStatus('Tag attached.');
      await load();
    } catch (e) {
      setStatus('Attach error: ' + (e as Error).message);
    }
  }

  return (
    <section className="panel" id="tags">
      <h2>Tags (Knex)</h2>
      <div className="row">
        <input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="usageCount">usageCount</option>
          <option value="name">name</option>
        </select>
        <select value={order} onChange={(e) => setOrder(e.target.value)}>
          <option value="desc">desc</option>
          <option value="asc">asc</option>
        </select>
        <button onClick={() => void load()}>Search</button>
      </div>

      {isAdmin && (
        <div className="row">
          <input placeholder="new tag" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input placeholder="description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
          <button onClick={() => void createTag()}>Create tag (Admin)</button>
        </div>
      )}

      {(isAdmin || isModerator) && (
        <div className="row">
          <input placeholder="postId" value={attachPostId} onChange={(e) => setAttachPostId(e.target.value)} />
          <input placeholder="tag" value={attachTag} onChange={(e) => setAttachTag(e.target.value)} />
          <button onClick={() => void attach()}>Attach tag</button>
        </div>
      )}

      {status && <div className="status">{status}</div>}
      <ul>
        {tags.length === 0 && <li className="empty">No tags.</li>}
        {tags.map((t) => (
          <li key={t.name} className="tag-item">
            <div className="tag-header">
              #{t.name} <small>(usage: {t.usageCount ?? 0})</small>
            </div>
            {t.description && <div className="tag-desc">{t.description}</div>}
            <button className="show-tag-posts" onClick={() => void showPosts(t.name)}>
              Posts with this tag
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
