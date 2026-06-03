import { useState } from 'react';
import { useApi } from '../api';

const ENDPOINTS: { label: string; path: string }[] = [
  { label: 'Trending', path: '/analytics/trending' },
  { label: 'Top autorzy (tydzień)', path: '/analytics/top-authors-weekly' },
  { label: 'Rozkład reakcji', path: '/analytics/reaction-distribution' },
  { label: 'Logi systemowe', path: '/analytics/system-logs' },
];

export function Analytics() {
  const { request } = useApi();
  const [result, setResult] = useState('');
  const [level, setLevel] = useState('info');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');

  async function loadEndpoint(path: string) {
    setResult('Ładowanie ' + path + '…');
    try {
      const res = await request(path);
      setResult(JSON.stringify(res, null, 2));
    } catch (e) {
      setResult('Błąd: ' + (e as Error).message);
    }
  }

  async function sendLog() {
    if (!message.trim()) return;
    setStatus('Wysyłanie…');
    try {
      const res = await request<{ id?: string }>('/analytics/system-logs', {
        method: 'POST',
        body: JSON.stringify({ level, message: message.trim(), metadata: {} }),
      });
      setStatus('OK, id=' + (res?.id ?? '?'));
      setMessage('');
    } catch (e) {
      setStatus('Błąd: ' + (e as Error).message);
    }
  }

  return (
    <section className="panel" id="analytics">
      <h2>Analityka (MongoDB)</h2>
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
        <input className="grow" placeholder="wiadomość loga" value={message} onChange={(e) => setMessage(e.target.value)} />
        <button onClick={() => void sendLog()}>Wyślij log</button>
      </div>
      {status && <div className="status">{status}</div>}
      {result && <pre className="result">{result}</pre>}
    </section>
  );
}
