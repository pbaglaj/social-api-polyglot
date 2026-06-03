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
      setStatus('Błąd ładowania: ' + (e as Error).message);
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
        `#${tag} — postów: ${res?.count ?? 0}\n\n` +
          (res?.posts ?? []).map((p) => `#${p.id} (author ${p.authorId}): ${p.bodyPreview}`).join('\n'),
      );
    } catch (e) {
      alert('Błąd: ' + (e as Error).message);
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
      setStatus('Utworzono tag.');
      await load();
    } catch (e) {
      setStatus('Błąd tworzenia: ' + (e as Error).message);
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
      setStatus('Przypisano tag.');
      await load();
    } catch (e) {
      setStatus('Błąd przypisania: ' + (e as Error).message);
    }
  }

  return (
    <section className="panel" id="tags">
      <h2>Tagi (Knex)</h2>
      <div className="row">
        <input placeholder="nazwa" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="usageCount">usageCount</option>
          <option value="name">name</option>
        </select>
        <select value={order} onChange={(e) => setOrder(e.target.value)}>
          <option value="desc">desc</option>
          <option value="asc">asc</option>
        </select>
        <button onClick={() => void load()}>Szukaj</button>
      </div>

      {isAdmin && (
        <div className="row">
          <input placeholder="nowy tag" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input placeholder="opis (opcj.)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
          <button onClick={() => void createTag()}>Utwórz tag (Admin)</button>
        </div>
      )}

      {(isAdmin || isModerator) && (
        <div className="row">
          <input placeholder="postId" value={attachPostId} onChange={(e) => setAttachPostId(e.target.value)} />
          <input placeholder="tag" value={attachTag} onChange={(e) => setAttachTag(e.target.value)} />
          <button onClick={() => void attach()}>Przypisz tag</button>
        </div>
      )}

      {status && <div className="status">{status}</div>}
      <ul>
        {tags.length === 0 && <li className="empty">Brak tagów.</li>}
        {tags.map((t) => (
          <li key={t.name} className="tag-item">
            <div className="tag-header">
              #{t.name} <small>(usage: {t.usageCount ?? 0})</small>
            </div>
            {t.description && <div className="tag-desc">{t.description}</div>}
            <button className="show-tag-posts" onClick={() => void showPosts(t.name)}>
              Posty z tym tagiem
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
