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
    li.innerHTML = `<div class="post-header">#${p.id} • ${p.authorId || (p.author && p.author.username) || 'anon'}</div>
      <div class="post-body">${escapeHtml(p.bodyPreview || '')}</div>
      <div class="post-actions">
        <button data-id="${p.id}" class="react">❤️ Like (${reactionCount})</button>
      </div>`;
    list.appendChild(li);
  });
  list.querySelectorAll('.react').forEach(btn => btn.addEventListener('click', onReact));
}

function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

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
    const res = await request(`/users/${id}/follow`, { method: 'POST', body: JSON.stringify({ followerId }) });
    console.log('Follow response:', res);
    alert('Followed user ' + id);
  }catch(err){ 
    console.error('Follow error:', err);
    alert('Błąd follow: '+err.message); 
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
