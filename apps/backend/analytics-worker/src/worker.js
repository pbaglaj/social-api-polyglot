// Client nr 3 - M2M (backend-2-backend) z OAuth2 Client Credentials.
//
// Bez udzialu czlowieka: worker zdobywa token na podstawie client_id + client_secret
// (b2b-client) i cyklicznie agreguje dane analityczne z mongo-service. Klient ma w realmie
// TYLKO role 'analytics' (least-privilege) - dowodem jest probny strzal w /api/feed (403).
//
// Caly ruch idzie po sieci docker 'internal' (keycloak:8080, mongo-service:3002).

const REALM = process.env.KEYCLOAK_REALM || 'SocialPolyglot';
const KC_INTERNAL_URL = process.env.KEYCLOAK_INTERNAL_URL || 'http://keycloak:8080';
const CLIENT_ID = process.env.B2B_CLIENT_ID || 'b2b-client';
const CLIENT_SECRET = process.env.B2B_CLIENT_SECRET || 'b2b-client-secret';
const MONGO_BASE = process.env.MONGO_SERVICE_URL || 'http://mongo-service:3002';
const INTERVAL_MS = (Number(process.env.ANALYTICS_POLL_INTERVAL_SECONDS) || 60) * 1000;

const TOKEN_URL = `${KC_INTERNAL_URL}/realms/${REALM}/protocol/openid-connect/token`;
const ANALYTICS = ['/api/analytics/trending', '/api/analytics/top-authors-weekly', '/api/analytics/reaction-distribution'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[analytics-worker ${new Date().toISOString()}]`, ...a);

let cached = null;
async function getToken(force = false) {
  if (!force && cached && cached.expiresAt > Date.now() + 5000) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  const data = await res.json();
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

// Czeka az Keycloak wstanie. Pierwszy boot Keycloaka z --import-realm potrafi trwac
// 60-120s, dlatego retry jest praktycznie nieograniczony (worker bez Keycloaka nie ma
// nic do roboty - lepiej cierpliwie czekac niz ubic kontener).
async function waitForKeycloak(intervalMs = 5000) {
  for (let i = 1; ; i++) {
    try {
      await getToken(true);
      log(`Token z Keycloak zdobyty (Client Credentials) po ${i} probie.`);
      return;
    } catch (e) {
      log(`Czekam na Keycloak (proba ${i}): ${e.message}`);
      await sleep(intervalMs);
    }
  }
}

async function callApi(path) {
  let token = await getToken();
  let res = await fetch(`${MONGO_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    // token wygasl - odswiezamy raz i ponawiamy
    token = await getToken(true);
    res = await fetch(`${MONGO_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  }
  return res;
}

// Dowod least-privilege: 'analytics' NIE ma dostepu do feedu uzytkownika -> oczekujemy 403.
async function proveLeastPrivilege() {
  try {
    const res = await callApi('/api/feed/1');
    log(`RBAC check: GET /api/feed/1 -> ${res.status} ${res.status === 403 ? '(OK: brak roli usera)' : '(!) nieoczekiwane'}`);
  } catch (e) {
    log('RBAC check blad:', e.message);
  }
}

async function aggregate() {
  for (const path of ANALYTICS) {
    try {
      const res = await callApi(path);
      if (!res.ok) {
        log(`${path} -> ${res.status}`);
        continue;
      }
      const data = await res.json();
      const summary = Array.isArray(data) ? `${data.length} pozycji` : Object.keys(data || {}).join(', ');
      log(`${path} -> 200 | ${summary}`);
    } catch (e) {
      log(`${path} -> blad: ${e.message}`);
    }
  }
}

let timer = null;
async function main() {
  log(`Start. Interval=${INTERVAL_MS / 1000}s, klient=${CLIENT_ID}.`);
  await waitForKeycloak();
  await proveLeastPrivilege();
  await aggregate();
  timer = setInterval(() => {
    aggregate().catch((e) => log('aggregate error:', e.message));
  }, INTERVAL_MS);
}

function shutdown() {
  log('SIGTERM/SIGINT - graceful shutdown.');
  if (timer) clearInterval(timer);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main().catch((e) => {
  log('Fatal:', e.message);
  process.exit(1);
});
