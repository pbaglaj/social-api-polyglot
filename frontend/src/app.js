const $ = (id) => document.getElementById(id);

function apiBase() {
  return $('apiBase').value.replace(/\/+$/, '');
}

function currentUserId() {
  return parseInt($('followerId').value, 10) || 1;
}

function currentReactionType() {
  return ($('reactionType') && $('reactionType').value) || 'like';
}

async function request(path, opts = {}) {
  const base = apiBase();
  const res = await fetch(base + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  if (!res.ok) {
    let err = await res.text();
    throw new Error(err || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------- POSTS ----------------

async function loadPosts(query = '') {
  try {
    const posts = await request('/posts' + query);
    renderPosts(posts || []);
  } catch (e) { alert('Błąd ładowania postów: ' + e.message); }
}

async function filterPosts() {
  const params = new URLSearchParams();
  const authorId = $('filterAuthorId').value.trim();
  const hashtag = $('filterHashtag').value.trim();
  if (authorId) params.set('authorId', authorId);
  if (hashtag) params.set('hashtag', hashtag);
  const q = params.toString();
  await loadPosts(q ? '?' + q : '');
}

function renderPosts(posts) {
  const list = $('postsList');
  list.innerHTML = '';
  const me = currentUserId();
  if (!posts.length) {
    list.innerHTML = '<li class="empty">Brak postów.</li>';
    return;
  }
  posts.forEach(p => {
    const li = document.createElement('li');
    li.className = 'post';
    const reactionCount = p._count?.reactions || 0;
    const authorName = (p.author && p.author.username) || `user-${p.authorId || 'unknown'}`;
    const canDelete = Number(p.authorId) === Number(me);
    li.innerHTML = `<div class="post-header">${escapeHtml(authorName)} • author ID: ${p.authorId ?? 'brak'} • Post #${p.id}</div>
      <div class="post-body">${escapeHtml(p.bodyPreview || '')}</div>
      <div class="post-actions">
        <button data-id="${p.id}" class="react">React (${reactionCount})</button>
        <button data-id="${p.id}" class="toggle-comments">Komentarze</button>
        ${canDelete ? `<button data-id="${p.id}" class="delete-post danger">Usuń</button>` : ''}
      </div>
      <div class="comments-panel hidden" data-post-id="${p.id}">
        <ul class="comments-list" data-post-id="${p.id}"></ul>
        <div class="comment-form">
          <input class="comment-content" data-post-id="${p.id}" placeholder="Napisz komentarz..." />
          <input class="comment-parent" data-post-id="${p.id}" type="number" placeholder="parentId (opcj.)" />
          <button data-id="${p.id}" class="add-comment">Dodaj</button>
        </div>
      </div>`;
    list.appendChild(li);
  });
  list.querySelectorAll('.react').forEach(btn => btn.addEventListener('click', onReact));
  list.querySelectorAll('.toggle-comments').forEach(btn => btn.addEventListener('click', onToggleComments));
  list.querySelectorAll('.add-comment').forEach(btn => btn.addEventListener('click', onAddComment));
  list.querySelectorAll('.delete-post').forEach(btn => btn.addEventListener('click', onDeletePost));
}

// ---------------- COMMENTS ----------------

function renderComments(comments, postId) {
  const list = document.querySelector(`.comments-list[data-post-id="${postId}"]`);
  if (!list) return;

  const groupedByParent = new Map();
  (comments || []).forEach(comment => {
    const key = comment.parentId == null ? 'root' : String(comment.parentId);
    if (!groupedByParent.has(key)) groupedByParent.set(key, []);
    groupedByParent.get(key).push(comment);
  });

  const renderLevel = (parentKey, depth) => {
    const entries = groupedByParent.get(parentKey) || [];
    return entries.map(comment => {
      const authorName = (comment.author && comment.author.username) || `user-${comment.authorId}`;
      const children = renderLevel(String(comment.id), depth + 1);
      return `<li class="comment-item depth-${Math.min(depth, 4)}">
        <div class="comment-meta">${escapeHtml(authorName)} • author ID: ${comment.authorId} • Komentarz #${comment.id}</div>
        <div class="comment-content">${escapeHtml(comment.content || '')}</div>
        ${children ? `<ul class="comment-children">${children}</ul>` : ''}
      </li>`;
    }).join('');
  };

  list.innerHTML = renderLevel('root', 0) || '<li class="comment-empty">Brak komentarzy.</li>';
}

async function loadComments(postId) {
  const panel = document.querySelector(`.comments-panel[data-post-id="${postId}"]`);
  if (!panel) return;
  const comments = await request(`/posts/${postId}/comments`);
  renderComments(comments || [], postId);
  panel.dataset.loaded = 'true';
}

async function onToggleComments(e) {
  const button = e.currentTarget;
  const postId = button.dataset.id;
  const panel = document.querySelector(`.comments-panel[data-post-id="${postId}"]`);
  if (!panel) return;

  const shouldOpen = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  button.textContent = shouldOpen ? 'Ukryj komentarze' : 'Komentarze';

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
  const postId = button.dataset.id;
  const contentInput = document.querySelector(`.comment-content[data-post-id="${postId}"]`);
  const parentInput = document.querySelector(`.comment-parent[data-post-id="${postId}"]`);
  const panel = document.querySelector(`.comments-panel[data-post-id="${postId}"]`);
  if (!contentInput || !panel) return;

  const content = contentInput.value.trim();
  if (!content) { alert('Treść komentarza nie może być pusta.'); return; }

  const payload = { authorId: currentUserId(), content };
  const parentVal = parentInput && parentInput.value.trim();
  if (parentVal) payload.parentId = parseInt(parentVal, 10);

  try {
    button.disabled = true;
    button.textContent = '...';
    await request(`/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify(payload) });
    contentInput.value = '';
    if (parentInput) parentInput.value = '';
    panel.classList.remove('hidden');
    await loadComments(postId);
  } catch (err) {
    alert('Błąd dodawania komentarza: ' + err.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Dodaj';
  }
}

// ---------------- REACTIONS ----------------

async function onReact(e) {
  const button = e.currentTarget;
  const id = button.dataset.id;
  const userId = currentUserId();
  const type = currentReactionType();
  try {
    button.disabled = true;
    button.textContent = 'Reagowanie...';
    await request(`/posts/${id}/reactions`, { method: 'POST', body: JSON.stringify({ userId, type }) });
    await loadPosts();
  } catch (err) {
    alert('Błąd reakcji: ' + err.message);
  } finally {
    if (button && document.body.contains(button)) button.disabled = false;
  }
}

async function onDeletePost(e) {
  const button = e.currentTarget;
  const postId = button.dataset.id;
  if (!postId) return;
  if (!window.confirm('Czy na pewno chcesz usunąć ten post?')) return;

  try {
    button.disabled = true;
    button.textContent = 'Usuwanie...';
    await request(`/posts/${postId}`, {
      method: 'DELETE',
      body: JSON.stringify({ requesterId: currentUserId() })
    });
    await loadPosts();
  } catch (err) {
    alert('Błąd usuwania posta: ' + err.message);
  } finally {
    if (button && document.body.contains(button)) {
      button.disabled = false;
      button.textContent = 'Usuń';
    }
  }
}

async function createPost() {
  const authorId = parseInt($('newAuthorId').value, 10) || 1;
  const bodyPreview = $('newBody').value || '';
  const payload = { authorId, bodyPreview };

  const attachmentsRaw = $('newAttachments').value.trim();
  const pollRaw = $('newPoll').value.trim();
  try {
    if (attachmentsRaw) payload.attachments = JSON.parse(attachmentsRaw);
    if (pollRaw) payload.poll = JSON.parse(pollRaw);
  } catch (e) {
    $('createStatus').textContent = 'Błąd JSON w attachments/poll: ' + e.message;
    return;
  }

  $('createStatus').textContent = 'Wysyłanie...';
  try {
    const created = await request('/posts', { method: 'POST', body: JSON.stringify(payload) });
    $('createStatus').textContent = 'Utworzono post id=' + (created && created.id);
    $('newBody').value = '';
    $('newAttachments').value = '';
    $('newPoll').value = '';
    loadPosts();
  } catch (e) {
    $('createStatus').textContent = 'Błąd: ' + e.message;
  }
}

// ---------------- USERS ----------------

async function loadUsers() {
  try {
    const params = new URLSearchParams();
    const username = $('userSearchUsername').value.trim();
    const email = $('userSearchEmail').value.trim();
    if (username) params.set('username', username);
    if (email) params.set('email', email);
    const q = params.toString();
    const res = await request('/users' + (q ? '?' + q : ''));
    const users = (res && res.users) || res || [];
    const ul = $('usersList');
    ul.innerHTML = '';
    if (!users.length) {
      ul.innerHTML = '<li class="empty">Brak użytkowników.</li>';
      return;
    }
    users.forEach(u => {
      const li = document.createElement('li');
      li.innerHTML = `<span><b>#${u.id}</b> ${escapeHtml(u.username || u.email || 'user')} <small>${escapeHtml(u.email || '')}</small></span>
        <button data-id="${u.id}" class="follow">Follow</button>
        <button data-id="${u.id}" class="unfollow danger">Unfollow</button>`;
      ul.appendChild(li);
    });
    ul.querySelectorAll('.follow').forEach(b => b.addEventListener('click', onFollow));
    ul.querySelectorAll('.unfollow').forEach(b => b.addEventListener('click', onUnfollow));
  } catch (e) { alert('Błąd ładowania użytkowników: ' + e.message); }
}

async function onFollow(e) {
  const button = e.currentTarget;
  const id = button.dataset.id;
  try {
    button.disabled = true;
    await request(`/users/${id}/follow`, { method: 'POST', body: JSON.stringify({ followerId: currentUserId() }) });
    alert('Followed user ' + id);
  } catch (err) {
    alert('Błąd follow: ' + err.message);
  } finally { button.disabled = false; }
}

async function onUnfollow(e) {
  const button = e.currentTarget;
  const id = button.dataset.id;
  try {
    button.disabled = true;
    await request(`/users/${id}/follow`, { method: 'DELETE', body: JSON.stringify({ followerId: currentUserId() }) });
    alert('Unfollowed user ' + id);
  } catch (err) {
    alert('Błąd unfollow: ' + err.message);
  } finally { button.disabled = false; }
}

// ---------------- FEED ----------------

let feedCursor = null;

async function loadFeed(append = false) {
  const uid = parseInt($('feedUserId').value, 10) || 1;
  const limit = parseInt($('feedLimit').value, 10) || 10;
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (append && feedCursor) params.set('cursor', feedCursor);

  try {
    $('feedStatus').textContent = 'Ładowanie...';
    const feed = await request(`/feed/${uid}?${params.toString()}`);
    const feedData = (feed && feed.data) || (Array.isArray(feed) ? feed : []);
    feedCursor = (feed && feed.nextCursor) || null;
    $('loadFeedNextBtn').disabled = !feedCursor;

    const ul = $('feedList');
    if (!append) ul.innerHTML = '';
    if (!feedData.length && !append) {
      ul.innerHTML = '<li class="empty">Brak wpisów w feedzie.</li>';
      $('feedStatus').textContent = '';
      return;
    }
    feedData.forEach(entry => {
      const li = document.createElement('li');
      li.className = 'feed-entry';
      const rich = entry.richPost || {};
      li.innerHTML = `<div class="post-header">Feed entry • postId: ${entry.postId} • score: ${entry.score ?? '-'} • ${entry.insertedAt ? new Date(entry.insertedAt).toLocaleString() : ''}</div>
        <div class="post-body">RichPost: ${rich.postId ? `#${rich.postId}` : 'brak'} • attachments: ${(rich.attachments || []).length} • poll: ${rich.poll ? 'tak' : 'nie'}</div>`;
      ul.appendChild(li);
    });
    $('feedStatus').textContent = feedCursor ? 'Załadowano. Można pobrać następną stronę.' : 'Załadowano (koniec).';
  } catch (e) {
    $('feedStatus').textContent = 'Błąd ładowania feedu: ' + e.message;
  }
}

// ---------------- ANALYTICS ----------------

async function loadAnalytics(endpoint) {
  try {
    $('analyticsResult').textContent = 'Ładowanie ' + endpoint + '...';
    const res = await request(endpoint);
    $('analyticsResult').textContent = JSON.stringify(res, null, 2);
  } catch (e) {
    $('analyticsResult').textContent = 'Błąd: ' + e.message;
  }
}

// ---------------- SYSTEM LOGS ----------------

async function sendLog() {
  const level = $('logLevel').value;
  const message = $('logMessage').value.trim();
  const metaRaw = $('logMetadata').value.trim();
  if (!message) { $('logStatus').textContent = 'Brak treści.'; return; }
  let metadata = {};
  if (metaRaw) {
    try { metadata = JSON.parse(metaRaw); }
    catch (e) { $('logStatus').textContent = 'Błąd JSON: ' + e.message; return; }
  }
  try {
    $('logStatus').textContent = 'Wysyłanie...';
    const res = await request('/analytics/system-logs', {
      method: 'POST',
      body: JSON.stringify({ level, message, metadata })
    });
    $('logStatus').textContent = 'OK, id=' + (res && res.id);
    $('logMessage').value = '';
    $('logMetadata').value = '';
  } catch (e) {
    $('logStatus').textContent = 'Błąd: ' + e.message;
  }
}

// ---------------- STATS (T1 - pg native) ----------------

async function loadUserStats() {
  const userId = parseInt($('statsUserId').value, 10);
  if (!Number.isInteger(userId)) { $('statsResult').textContent = 'Podaj prawidłowe userId.'; return; }
  try {
    $('statsResult').textContent = 'Ładowanie statystyk użytkownika...';
    const res = await request(`/stats/user/${userId}`);
    $('statsResult').textContent = JSON.stringify(res, null, 2);
  } catch (e) {
    $('statsResult').textContent = 'Błąd: ' + e.message;
  }
}

async function loadTopPosts() {
  const limit = parseInt($('statsTopLimit').value, 10) || 5;
  const since = $('statsTopSince').value.trim();
  const params = new URLSearchParams({ limit: String(limit) });
  if (since) params.set('since', since);
  try {
    $('statsResult').textContent = 'Ładowanie top postów...';
    const res = await request(`/stats/posts/top?${params.toString()}`);
    $('statsResult').textContent = JSON.stringify(res, null, 2);
  } catch (e) {
    $('statsResult').textContent = 'Błąd: ' + e.message;
  }
}

// ---------------- TAGS (T2 - Knex.js) ----------------

async function loadTags() {
  const params = new URLSearchParams();
  const name = $('tagSearchName').value.trim();
  const minUsage = $('tagMinUsage').value.trim();
  const sortBy = $('tagSort').value;
  const order = $('tagOrder').value;
  if (name) params.set('name', name);
  if (minUsage) params.set('minUsage', minUsage);
  params.set('sortBy', sortBy);
  params.set('order', order);

  try {
    const res = await request(`/tags?${params.toString()}`);
    const tags = (res && res.tags) || [];
    const ul = $('tagsList');
    ul.innerHTML = '';
    if (!tags.length) {
      ul.innerHTML = '<li class="empty">Brak tagów.</li>';
      return;
    }
    tags.forEach(t => {
      const li = document.createElement('li');
      li.className = 'tag-item';
      li.innerHTML = `<div class="tag-header">#${escapeHtml(t.name)} <small>(usage: ${t.usageCount ?? 0})</small></div>
        ${t.description ? `<div class="tag-desc">${escapeHtml(t.description)}</div>` : ''}
        <button data-tag="${escapeHtml(t.name)}" class="show-tag-posts">Posty z tym tagiem</button>`;
      ul.appendChild(li);
    });
    ul.querySelectorAll('.show-tag-posts').forEach(b => b.addEventListener('click', onShowTagPosts));
  } catch (e) {
    $('tagStatus').textContent = 'Błąd ładowania: ' + e.message;
  }
}

async function onShowTagPosts(e) {
  const tag = e.currentTarget.dataset.tag;
  try {
    const res = await request(`/tags/${encodeURIComponent(tag)}/posts`);
    alert(`#${tag} — postów: ${res.count}\n\n` +
      (res.posts || []).map(p => `#${p.id} (author ${p.authorId}): ${p.bodyPreview}`).join('\n'));
  } catch (err) { alert('Błąd: ' + err.message); }
}

async function createTag() {
  const name = $('newTagName').value.trim();
  const description = $('newTagDescription').value.trim();
  if (!name) { $('tagStatus').textContent = 'Podaj nazwę tagu.'; return; }
  try {
    $('tagStatus').textContent = 'Tworzenie...';
    const res = await request('/tags', {
      method: 'POST',
      body: JSON.stringify({ name, description: description || undefined })
    });
    $('tagStatus').textContent = `Utworzono tag #${res.name} (id=${res.id}).`;
    $('newTagName').value = '';
    $('newTagDescription').value = '';
    loadTags();
  } catch (e) {
    $('tagStatus').textContent = 'Błąd: ' + e.message;
  }
}

async function attachTag() {
  const postId = parseInt($('attachPostId').value, 10);
  const tagName = $('attachTagName').value.trim();
  if (!Number.isInteger(postId) || !tagName) {
    $('tagStatus').textContent = 'Podaj postId i tag.'; return;
  }
  try {
    $('tagStatus').textContent = 'Przypisywanie...';
    const res = await request('/tags/attach', {
      method: 'POST',
      body: JSON.stringify({ postId, tagName })
    });
    $('tagStatus').textContent = `Przypisano #${res.tag.name} do postu #${res.postId}.`;
    $('attachPostId').value = '';
    $('attachTagName').value = '';
    loadTags();
  } catch (e) {
    $('tagStatus').textContent = 'Błąd: ' + e.message;
  }
}

// ---------------- NOTIFICATIONS (T3 - Sequelize) ----------------

async function loadNotifications() {
  const userId = parseInt($('notifUserId').value, 10);
  if (!Number.isInteger(userId)) { $('notifStatus').textContent = 'Podaj prawidłowe userId.'; return; }
  const params = new URLSearchParams();
  if ($('notifUnreadOnly').checked) params.set('unread', 'true');

  try {
    const res = await request(`/notifications/${userId}?${params.toString()}`);
    const list = (res && res.notifications) || [];
    const ul = $('notificationsList');
    ul.innerHTML = '';
    if (!list.length) {
      ul.innerHTML = '<li class="empty">Brak powiadomień.</li>';
      return;
    }
    list.forEach(n => {
      const li = document.createElement('li');
      li.className = 'notification-item' + (n.isRead ? ' is-read' : '');
      const typeName = (n.type && n.type.name) || '?';
      const typeIcon = (n.type && n.type.icon) || '';
      const date = n.createdAt ? new Date(n.createdAt).toLocaleString() : '';
      li.innerHTML = `<div class="notif-header">${escapeHtml(typeIcon)} <b>${escapeHtml(typeName)}</b>
        <small>• ${date} ${n.isRead ? '• przeczytane' : '• <b>NOWE</b>'}</small></div>
        <div class="notif-body">${escapeHtml(n.message || '')}</div>
        <button data-id="${n.id}" class="delete-notif danger">Usuń</button>`;
      ul.appendChild(li);
    });
    ul.querySelectorAll('.delete-notif').forEach(b => b.addEventListener('click', onDeleteNotification));
  } catch (e) {
    $('notifStatus').textContent = 'Błąd: ' + e.message;
  }
}

async function onDeleteNotification(e) {
  const id = e.currentTarget.dataset.id;
  try {
    await request(`/notifications/${id}`, { method: 'DELETE' });
    loadNotifications();
  } catch (err) { alert('Błąd usuwania: ' + err.message); }
}

async function markAllRead() {
  const userId = parseInt($('notifUserId').value, 10);
  if (!Number.isInteger(userId)) { $('notifStatus').textContent = 'Podaj prawidłowe userId.'; return; }
  try {
    $('notifStatus').textContent = 'Oznaczanie...';
    const res = await request(`/notifications/${userId}/read-all`, { method: 'PATCH' });
    $('notifStatus').textContent = `Oznaczono ${res.markedAsRead} powiadomień.`;
    loadNotifications();
  } catch (e) {
    $('notifStatus').textContent = 'Błąd: ' + e.message;
  }
}

async function createNotification() {
  const userId = parseInt($('newNotifUserId').value, 10);
  const typeName = $('newNotifType').value;
  const message = $('newNotifMessage').value.trim();
  if (!Number.isInteger(userId) || !message) {
    $('notifStatus').textContent = 'Wypełnij userId i wiadomość.'; return;
  }
  try {
    $('notifStatus').textContent = 'Tworzenie...';
    const res = await request('/notifications', {
      method: 'POST',
      body: JSON.stringify({ userId, typeName, message })
    });
    $('notifStatus').textContent = `Utworzono powiadomienie #${res.id}.`;
    $('newNotifMessage').value = '';
    loadNotifications();
  } catch (e) {
    $('notifStatus').textContent = 'Błąd: ' + e.message;
  }
}

// ---------------- SETUP ----------------

function setup() {
  $('loadPostsBtn').addEventListener('click', () => loadPosts());
  $('filterPostsBtn').addEventListener('click', filterPosts);
  $('createPostBtn').addEventListener('click', createPost);
  $('loadUsersBtn').addEventListener('click', loadUsers);
  $('loadFeedBtn').addEventListener('click', () => { feedCursor = null; loadFeed(false); });
  $('loadFeedNextBtn').addEventListener('click', () => loadFeed(true));
  $('refreshBtn').addEventListener('click', () => { loadPosts(); loadUsers(); });
  $('sendLogBtn').addEventListener('click', sendLog);
  document.querySelectorAll('.analytics-btn').forEach(btn => {
    btn.addEventListener('click', () => loadAnalytics(btn.dataset.endpoint));
  });

  // T1 stats
  $('loadStatsBtn').addEventListener('click', loadUserStats);
  $('loadTopPostsBtn').addEventListener('click', loadTopPosts);

  // T2 tags
  $('loadTagsBtn').addEventListener('click', loadTags);
  $('createTagBtn').addEventListener('click', createTag);
  $('attachTagBtn').addEventListener('click', attachTag);

  // T3 notifications
  $('loadNotificationsBtn').addEventListener('click', loadNotifications);
  $('markAllReadBtn').addEventListener('click', markAllRead);
  $('createNotifBtn').addEventListener('click', createNotification);

  loadPosts();
}

document.addEventListener('DOMContentLoaded', setup);
