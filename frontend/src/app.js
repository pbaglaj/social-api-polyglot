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
    li.innerHTML = `<div class="post-header">#${p.id} • ${p.authorId || (p.author && p.author.username) || 'anon'}</div>
      <div class="post-body">${escapeHtml(p.bodyPreview || '')}</div>
      <div class="post-actions">
        <button data-id="${p.id}" class="react">Like</button>
      </div>`;
    list.appendChild(li);
  });
  list.querySelectorAll('.react').forEach(btn => btn.addEventListener('click', onReact));
}

function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function onReact(e){
  const id = e.currentTarget.dataset.id;
  const userId = parseInt($('followerId').value,10) || 1;
  try{
    await request(`/posts/${id}/reactions`, { method: 'POST', body: JSON.stringify({ userId, type: 'like' }) });
    alert('Zareagowano');
  }catch(err){ alert('Błąd reakcji: '+err.message); }
}

async function createPost(){
  const authorId = parseInt($('newAuthorId').value,10) || 1;
  const bodyPreview = $('newBody').value || '';
  $('createStatus').textContent = 'Wysyłanie...';
  try{
    const created = await request('/posts', { method: 'POST', body: JSON.stringify({ authorId, bodyPreview }) });
    $('createStatus').textContent = 'Utworzono post id=' + (created && created.id);
    loadPosts();
  }catch(e){ $('createStatus').textContent = 'Błąd: ' + e.message; }
}

async function loadUsers(){
  try{
    const res = await request('/users');
    const users = (res && res.users) || res || [];
    const ul = $('usersList'); ul.innerHTML = '';
    users.forEach(u => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${u.id} • ${escapeHtml(u.username||u.email||'user')}</span> <button data-id="${u.id}" class="follow">Follow</button>`;
      ul.appendChild(li);
    });
    ul.querySelectorAll('.follow').forEach(b=>b.addEventListener('click', onFollow));
  }catch(e){ alert('Błąd ładowania użytkowników: '+e.message); }
}

async function onFollow(e){
  const id = e.currentTarget.dataset.id;
  const followerId = parseInt($('followerId').value,10) || 1;
  try{
    await request(`/users/${id}/follow`, { method: 'POST', body: JSON.stringify({ followerId }) });
    alert('Followed');
  }catch(err){ alert('Błąd follow: '+err.message); }
}

async function loadFeed(){
  const uid = parseInt($('feedUserId').value,10) || 1;
  try{
    const feed = await request(`/feed/${uid}`);
    // feed is likely list of feed entries with postId
    const postIds = (feed && Array.isArray(feed) ? feed : (feed && feed.feed) || [] ).map(f=>f.postId).filter(Boolean);
    if (postIds.length === 0) { $('postsList').innerHTML = '<li>Brak wpisów w feedzie.</li>'; return; }
    // fetch posts and filter
    const posts = await request('/posts');
    const filtered = (posts || []).filter(p => postIds.includes(p.id));
    renderPosts(filtered);
  }catch(e){ alert('Błąd ładowania feedu: '+e.message); }
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
