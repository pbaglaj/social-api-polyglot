import { useState } from 'react';
import { useApi } from '../api';

const ENDPOINTS: { label: string; path: string }[] = [
  { label: 'Trending', path: '/analytics/trending' },
  { label: 'Top authors (week)', path: '/analytics/top-authors-weekly' },
  { label: 'Reaction distribution', path: '/analytics/reaction-distribution' },
  { label: 'System logs', path: '/analytics/system-logs' },
];

export function Analytics() {
  const { request } = useApi();
  const [result, setResult] = useState('');
  const [level, setLevel] = useState('info');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');

  async function loadEndpoint(path: string) {
    setResult('Loading ' + path + '…');
    try {
      const res = await request(path);
      setResult(JSON.stringify(res, null, 2));
    } catch (e) {
      setResult('Error: ' + (e as Error).message);
    }
  }

  async function sendLog() {
    if (!message.trim()) return;
    setStatus('Sending…');
    try {
      const res = await request<{ id?: string }>('/analytics/system-logs', {
        method: 'POST',
        body: JSON.stringify({ level, message: message.trim(), metadata: {} }),
      });
      setStatus('OK, id=' + (res?.id ?? '?'));
      setMessage('');
    } catch (e) {
      setStatus('Error: ' + (e as Error).message);
    }
  }

  return (
    <section className="panel" id="analytics">
      <h2>Analytics (MongoDB)</h2>
      <div className="controls wrap">
        {ENDPOINTS.map((e) => (
          <button key={e.path} onClick={() => void loadEndpoint(e.path)}>
            {e.label}
          </button>
        ))}
      </div>
      <div className="row">
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
          <option value="debug">debug</option>
        </select>
        <input className="grow" placeholder="log message" value={message} onChange={(e) => setMessage(e.target.value)} />
        <button onClick={() => void sendLog()}>Send log</button>
      </div>
      {status && <div className="status">{status}</div>}
      {result && <pre className="result">{result}</pre>}
    </section>
  );
}
