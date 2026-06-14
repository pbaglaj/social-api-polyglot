import { useState } from 'react';
import { useApi } from '../api';

export function Stats({ userId }: { userId: number }) {
  const { request } = useApi();
  const [result, setResult] = useState('');
  const [statsUserId, setStatsUserId] = useState(String(userId));
  const [topLimit, setTopLimit] = useState(5);
  const [since, setSince] = useState('');

  async function userStats() {
    setResult('Loading…');
    try {
      const res = await request(`/stats/user/${parseInt(statsUserId, 10) || userId}`);
      setResult(JSON.stringify(res, null, 2));
    } catch (e) {
      setResult('Error: ' + (e as Error).message);
    }
  }

  async function topPosts() {
    const params = new URLSearchParams({ limit: String(topLimit) });
    if (since.trim()) params.set('since', since.trim());
    setResult('Loading…');
    try {
      const res = await request(`/stats/posts/top?${params.toString()}`);
      setResult(JSON.stringify(res, null, 2));
    } catch (e) {
      setResult('Error: ' + (e as Error).message);
    }
  }

  return (
    <section className="panel" id="stats">
      <h2>Stats (pg native)</h2>
      <div className="row">
        <input placeholder="userId" value={statsUserId} onChange={(e) => setStatsUserId(e.target.value)} />
        <button onClick={() => void userStats()}>User stats</button>
      </div>
      <div className="row">
        <label>
          limit:
          <input type="number" value={topLimit} onChange={(e) => setTopLimit(parseInt(e.target.value, 10) || 5)} />
        </label>
        <input placeholder="since (ISO, optional)" value={since} onChange={(e) => setSince(e.target.value)} />
        <button onClick={() => void topPosts()}>Top posts</button>
      </div>
      {result && <pre className="result">{result}</pre>}
    </section>
  );
}
