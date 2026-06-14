import { useEffect, useState } from 'react';
import { useApi } from '../api';
import { useNav } from '../nav';
import { PostCard, type Post } from './PostCard';

interface UserStats {
  user: { id: number; username: string; email: string; created_at?: string };
  stats: { postsCount: number; followersCount: number; followingCount: number; reactionsReceived: number };
}

const PAGE = 10; // domyslnie widocznych postow na profilu (zad. 1)

// Profil uzytkownika (zad. 2): liczniki obserwacji/postow (GET /stats/user/:id)
// + posty danej osoby (GET /posts?authorId=). Otwierany po kliknieciu w usera.
export function Profile({ selfId, isPrivileged }: { selfId: number; isPrivileged: boolean }) {
  const { request } = useApi();
  const { profileUserId } = useNav();
  const targetId = profileUserId ?? selfId;
  const isSelf = targetId === selfId;

  const [data, setData] = useState<UserStats | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [status, setStatus] = useState('');
  const [followMsg, setFollowMsg] = useState('');
  const [expanded, setExpanded] = useState(false);

  async function loadStats() {
    try {
      const res = await request<UserStats>(`/stats/user/${targetId}`);
      setData(res);
    } catch (e) {
      setStatus('Failed to load profile: ' + (e as Error).message);
    }
  }

  async function loadPosts() {
    try {
      const res = await request<Post[]>(`/posts?authorId=${targetId}`);
      setPosts(res ?? []);
      setExpanded(false);
    } catch (e) {
      setStatus('Failed to load posts: ' + (e as Error).message);
    }
  }

  useEffect(() => {
    setData(null);
    setPosts([]);
    setStatus('');
    setFollowMsg('');
    void loadStats();
    void loadPosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  async function follow() {
    try {
      await request(`/users/${targetId}/follow`, { method: 'POST', body: '{}' });
      setFollowMsg('You are now following this user.');
      await loadStats();
    } catch (e) {
      setFollowMsg('Follow error: ' + (e as Error).message);
    }
  }

  async function unfollow() {
    try {
      await request(`/users/${targetId}/follow`, { method: 'DELETE', body: '{}' });
      setFollowMsg('You unfollowed this user.');
      await loadStats();
    } catch (e) {
      setFollowMsg('Unfollow error: ' + (e as Error).message);
    }
  }

  const name = data?.user.username ?? `user-${targetId}`;
  const s = data?.stats;
  const visible = expanded ? posts : posts.slice(0, PAGE);

  return (
    <>
      <section className="card">
        <div className="profile-header">
          <span className="avatar lg">{name[0]?.toUpperCase() ?? '?'}</span>
          <div className="profile-headline">
            <h2>
              {name} <span className="profile-id">#{targetId}</span>
            </h2>
            <div className="profile-sub">{data?.user.email ?? ''}</div>
            <div className="profile-stats">
              <div className="stat">
                <span className="stat-num">{s?.postsCount ?? '—'}</span>
                <span className="stat-lbl">Posts</span>
              </div>
              <div className="stat">
                <span className="stat-num">{s?.followersCount ?? '—'}</span>
                <span className="stat-lbl">Followers</span>
              </div>
              <div className="stat">
                <span className="stat-num">{s?.followingCount ?? '—'}</span>
                <span className="stat-lbl">Following</span>
              </div>
              <div className="stat">
                <span className="stat-num">{s?.reactionsReceived ?? '—'}</span>
                <span className="stat-lbl">Reactions</span>
              </div>
            </div>
          </div>
          {!isSelf && (
            <div className="profile-actions">
              <button className="btn-primary" onClick={() => void follow()}>
                Follow
              </button>
              <button onClick={() => void unfollow()}>Unfollow</button>
            </div>
          )}
        </div>
        {followMsg && <div className="status">{followMsg}</div>}
        {status && <div className="status">{status}</div>}
      </section>

      <div className="section-label">{isSelf ? 'Your posts' : `Posts by ${name}`}</div>
      {posts.length === 0 ? (
        <div className="card empty-state">No posts.</div>
      ) : (
        <>
          {visible.map((p) => (
            <PostCard key={p.id} post={p} currentUserId={selfId} isPrivileged={isPrivileged} onChanged={() => void loadPosts()} />
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
