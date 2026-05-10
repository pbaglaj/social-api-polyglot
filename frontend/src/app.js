const $ = (id) => document.getElementById(id);

function apiBase() {
  return $('apiBase').value.replace(/\/+$/,'');
}

async function request(path, opts = {}) {
  const base = apiBase();
  const res = await fetch(base + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  if (!res.ok) {
    let err = await res.text();
    throw new Error(err || res.statusText);
  }
  return res.json().catch(() => null);
}

async function loadPosts() {
  try {
    const posts = await request('/posts');
    renderPosts(posts || []);
  } catch (e) { alert('Błąd ładowania postów: ' + e.message); }
}

function renderPosts(posts) {
  const list = $('postsList');
  list.innerHTML = '';
  posts.forEach(p => {
    const li = document.createElement('li');
    li.className = 'post';
    // Pokaż reaction count jeśli backend go zwraca (_count.reactions)
    const reactionCount = p._count?.reactions || 0;
    const authorName = (p.author && p.author.username) || `user-${p.authorId || 'unknown'}`;
    li.innerHTML = `<div class="post-header">${escapeHtml(authorName)} • ID: ${p.authorId || 'brak'} • Post #${p.id}</div>
      <div class="post-body">${escapeHtml(p.bodyPreview || '')}</div>
      <div class="post-actions">
        <button data-id="${p.id}" class="react">❤️ Like (${reactionCount})</button>
        <button data-id="${p.id}" class="toggle-comments">💬 Komentarze</button>
      </div>
      <div class="comments-panel hidden" data-post-id="${p.id}">
        <ul class="comments-list" data-post-id="${p.id}"></ul>
        <div class="comment-form">
          <input class="comment-content" data-post-id="${p.id}" placeholder="Napisz komentarz..." />
          <button data-id="${p.id}" class="add-comment">Dodaj komentarz</button>
        </div>
      </div>`;
    list.appendChild(li);
  });
  list.querySelectorAll('.react').forEach(btn => btn.addEventListener('click', onReact));
  list.querySelectorAll('.toggle-comments').forEach(btn => btn.addEventListener('click', onToggleComments));
  list.querySelectorAll('.add-comment').forEach(btn => btn.addEventListener('click', onAddComment));
}

function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderComments(comments, postId) {
  const list = document.querySelector(`.comments-list[data-post-id="${postId}"]`);
  if (!list) {
    return;
  }

  const groupedByParent = new Map();
  (comments || []).forEach(comment => {
    const key = comment.parentId == null ? 'root' : String(comment.parentId);
    if (!groupedByParent.has(key)) {
      groupedByParent.set(key, []);
    }
    groupedByParent.get(key).push(comment);
  });

  const renderLevel = (parentKey, depth) => {
    const entries = groupedByParent.get(parentKey) || [];
    return entries.map(comment => {
      const authorName = (comment.author && comment.author.username) || `user-${comment.authorId}`;
      const children = renderLevel(String(comment.id), depth + 1);
      return `<li class="comment-item depth-${Math.min(depth, 4)}">
        <div class="comment-meta">${escapeHtml(authorName)} • ID: ${comment.authorId} • Komentarz #${comment.id}</div>
        <div class="comment-content">${escapeHtml(comment.content || '')}</div>
        ${children ? `<ul class="comment-children">${children}</ul>` : ''}
      </li>`;
    }).join('');
  };

  const html = renderLevel('root', 0);
  list.innerHTML = html || '<li class="comment-empty">Brak komentarzy.</li>';
}

async function loadComments(postId) {
  const panel = document.querySelector(`.comments-panel[data-post-id="${postId}"]`);
  if (!panel) {
    return;
  }

  const comments = await request(`/posts/${postId}/comments`);
  renderComments(comments || [], postId);
  panel.dataset.loaded = 'true';
}

async function onToggleComments(e) {
  const button = e.currentTarget;
  if (!button) {
    return;
  }

  const postId = button.dataset.id;
  const panel = document.querySelector(`.comments-panel[data-post-id="${postId}"]`);
  if (!panel) {
    return;
  }

  const shouldOpen = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  button.textContent = shouldOpen ? '💬 Ukryj komentarze' : '💬 Komentarze';

  if (shouldOpen && panel.dataset.loaded !== 'true') {
    try {
      button.disabled = true;
      await loadComments(postId);
    } catch (err) {
      alert('Błąd ładowania komentarzy: ' + err.message);
    } finally {
      button.disabled = false;
    }
  }
}

async function onAddComment(e) {
  const button = e.currentTarget;
  if (!button) {
    return;
  }

  const postId = button.dataset.id;
  const contentInput = document.querySelector(`.comment-content[data-post-id="${postId}"]`);
  const panel = document.querySelector(`.comments-panel[data-post-id="${postId}"]`);

  if (!contentInput || !panel) {
    return;
  }

  const content = contentInput.value.trim();
  if (!content) {
    alert('Treść komentarza nie może być pusta.');
    return;
  }

  const authorId = parseInt($('followerId').value, 10) || 1;

  const payload = {
    authorId,
    content
  };

  try {
    button.disabled = true;
    button.textContent = 'Dodawanie...';
    await request(`/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify(payload) });
    contentInput.value = '';
    panel.classList.remove('hidden');
    await loadComments(postId);
  } catch (err) {
    alert('Błąd dodawania komentarza: ' + err.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Dodaj komentarz';
  }
}

async function onReact(e){
  const button = e.currentTarget;
  if (!button) {
    return;
  }

  const id = button.dataset.id;
  const userId = parseInt($('followerId').value,10) || 1;
  try{
    button.disabled = true;
    button.textContent = '❤️ Reagowanie...';

    const res = await request(`/posts/${id}/reactions`, { method: 'POST', body: JSON.stringify({ userId, type: 'like' }) });
    console.log('Reaction response:', res);
    
    // Reload postów aby zaktualizować liczbę reactions
    await loadPosts();
  }catch(err){ 
    console.error('Reaction error:', err);
    alert('Błąd reakcji: '+err.message); 
  } finally {
    if (button && document.body.contains(button)) {
      button.disabled = false;
    }
  }
}

async function createPost(){
  const authorId = parseInt($('newAuthorId').value,10) || 1;
  const bodyPreview = $('newBody').value || '';
  $('createStatus').textContent = 'Wysyłanie...';
  try{
    const created = await request('/posts', { method: 'POST', body: JSON.stringify({ authorId, bodyPreview }) });
    console.log('Post creation response:', created);
    $('createStatus').textContent = 'Utworzono post id=' + (created && created.id);
    loadPosts();
  }catch(e){ 
    console.error('Post creation error:', e);
    $('createStatus').textContent = 'Błąd: ' + e.message; 
  }
}

async function loadUsers(){
  try{
    const res = await request('/users');
    const users = (res && res.users) || res || [];
    const ul = $('usersList'); ul.innerHTML = '';
    users.forEach(u => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${u.id} • ${escapeHtml(u.username||u.email||'user')}</span>
        <button data-id="${u.id}" class="follow">Follow</button>
        <button data-id="${u.id}" class="unfollow">Unfollow</button>`;
      ul.appendChild(li);
    });
    ul.querySelectorAll('.follow').forEach(b=>b.addEventListener('click', onFollow));
    ul.querySelectorAll('.unfollow').forEach(b=>b.addEventListener('click', onUnfollow));
  }catch(e){ alert('Błąd ładowania użytkowników: '+e.message); }
}

async function onFollow(e){
  const button = e.currentTarget;
  if (!button) {
    return;
  }

  const id = button.dataset.id;
  const followerId = parseInt($('followerId').value,10) || 1;
  try{
    button.disabled = true;
    const res = await request(`/users/${id}/follow`, { method: 'POST', body: JSON.stringify({ followerId }) });
    console.log('Follow response:', res);
    alert('Followed user ' + id);
  }catch(err){ 
    console.error('Follow error:', err);
    alert('Błąd follow: '+err.message); 
  } finally {
    button.disabled = false;
  }
}

async function onUnfollow(e){
  const button = e.currentTarget;
  if (!button) {
    return;
  }

  const id = button.dataset.id;
  const followerId = parseInt($('followerId').value,10) || 1;
  try{
    button.disabled = true;
    await request(`/users/${id}/follow`, { method: 'DELETE', body: JSON.stringify({ followerId }) });
    alert('Unfollowed user ' + id);
  }catch(err){
    console.error('Unfollow error:', err);
    alert('Błąd unfollow: ' + err.message);
  } finally {
    button.disabled = false;
  }
}

async function loadFeed(){
  const uid = parseInt($('feedUserId').value,10) || 1;
  try{
    const feed = await request(`/feed/${uid}`);
    console.log('Feed response:', feed);
    // endpoint zwraca { data: [...], nextCursor }
    const feedData = feed && Array.isArray(feed) ? feed : (feed && feed.data) || [];
    console.log('Feed data extracted:', feedData);
    const postIds = feedData.map(f=>f.postId).filter(Boolean);
    console.log('Post IDs from feed:', postIds);
    if (postIds.length === 0) { $('postsList').innerHTML = '<li>Brak wpisów w feedzie.</li>'; return; }
    // fetch posts and filter
    const posts = await request('/posts');
    const filtered = (posts || []).filter(p => postIds.includes(p.id));
    console.log('Filtered posts:', filtered);
    renderPosts(filtered);
  }catch(e){ 
    console.error('Feed loading error:', e);
    alert('Błąd ładowania feedu: '+e.message); 
  }
}

function setup(){
  $('loadPostsBtn').addEventListener('click', loadPosts);
  $('createPostBtn').addEventListener('click', createPost);
  $('loadUsersBtn').addEventListener('click', loadUsers);
  $('loadFeedBtn').addEventListener('click', loadFeed);
  $('refreshBtn').addEventListener('click', ()=>{ loadPosts(); loadUsers(); });
  // initial
  loadPosts();
}

document.addEventListener('DOMContentLoaded', setup);
