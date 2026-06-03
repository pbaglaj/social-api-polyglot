// Client nr 2 - SSR (Server-Side Rendering) z OAuth2 Authorization Code (confidential).
//
// Cala wymiana tokenow dzieje sie po stronie serwera; przegladarka dostaje tylko cookie
// sesyjne (express-session). To rozni ten flow od SPA (gdzie token zyje w przegladarce).
//
// Dwa adresy Keycloaka (celowo):
//  - KC_PUBLIC_URL  (http://localhost:8090) - front-channel: redirect przegladarki na /auth.
//  - KC_INTERNAL_URL (http://keycloak:8080) - back-channel: wymiana code->token, Client
//    Credentials. Sieć docker 'internal'. Backend akceptuje oba issuery (allowlist).

import express from 'express';
import session from 'express-session';
import crypto from 'node:crypto';

const PORT = process.env.PORT || 4000;
const REALM = process.env.KEYCLOAK_REALM || 'SocialPolyglot';
const KC_PUBLIC_URL = process.env.KEYCLOAK_PUBLIC_URL || 'http://localhost:8090';
const KC_INTERNAL_URL = process.env.KEYCLOAK_INTERNAL_URL || 'http://keycloak:8080';
const CLIENT_ID = process.env.SSR_CLIENT_ID || 'ssr-client';
const CLIENT_SECRET = process.env.SSR_CLIENT_SECRET || 'ssr-client-secret';
const REDIRECT_URI = process.env.SSR_REDIRECT_URI || `http://localhost:${PORT}/callback`;
// API wolane z sieci wewnetrznej przez gateway (single entry point).
const API_BASE = process.env.SSR_API_BASE || 'http://api-gateway/api';
const SESSION_SECRET = process.env.SSR_SESSION_SECRET || 'ssr-dev-session-secret';

const PUBLIC_REALM = `${KC_PUBLIC_URL}/realms/${REALM}`;
const INTERNAL_REALM = `${KC_INTERNAL_URL}/realms/${REALM}`;

const app = express();
app.set('view engine', 'ejs');
app.set('views', new URL('../views', import.meta.url).pathname);
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 1000 },
  }),
);

// --- Service-account token (Client Credentials) z cache, do danych publicznych ---
let saCache = null;
async function getServiceToken() {
  if (saCache && saCache.expiresAt > Date.now() + 5000) return saCache.token;
  const res = await fetch(`${INTERNAL_REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Client Credentials ${res.status}: ${await res.text()}`);
  const data = await res.json();
  saCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function apiGet(path, token) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

// --- Landing page: publiczne posty + uzytkownicy (token service-accountu SSR) ---
app.get('/', async (req, res) => {
  let posts = [];
  let users = [];
  let error = null;
  try {
    const token = await getServiceToken();
    posts = (await apiGet('/posts', token)) || [];
    const u = await apiGet('/users', token);
    users = Array.isArray(u) ? u : u.users || [];
  } catch (e) {
    error = e.message;
  }
  res.render('index', { user: req.session.user || null, posts, users, error });
});

// --- Authorization Code: front-channel redirect na Keycloak (przegladarka) ---
app.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile email',
    state,
  });
  res.redirect(`${PUBLIC_REALM}/protocol/openid-connect/auth?${params.toString()}`);
});

// --- Callback: back-channel wymiana code->token (sekret klienta) ---
app.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || state !== req.session.oauthState) {
    return res.status(400).render('error', { message: 'Nieprawidlowy state/code (CSRF?).' });
  }
  delete req.session.oauthState;
  try {
    const tokenRes = await fetch(`${INTERNAL_REALM}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });
    if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}: ${await tokenRes.text()}`);
    const tokens = await tokenRes.json();
    // Dekodujemy payload tokenu tylko do wyswietlenia (walidacja podpisu jest w backendzie).
    const payload = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString());
    req.session.user = {
      username: payload.preferred_username,
      email: payload.email,
      roles: payload.realm_access?.roles || [],
    };
    req.session.accessToken = tokens.access_token;
    req.session.idToken = tokens.id_token;
    res.redirect('/dashboard');
  } catch (e) {
    res.status(500).render('error', { message: 'Wymiana code->token nie powiodla sie: ' + e.message });
  }
});

// --- Strona zalogowanego: spersonalizowane dane (token uzytkownika z sesji) ---
app.get('/dashboard', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  let whoami = null;
  let feed = [];
  let error = null;
  try {
    const token = req.session.accessToken;
    whoami = await apiGet('/admin/me', token);
    if (whoami?.appUser?.id != null) {
      const f = await apiGet(`/feed/${whoami.appUser.id}?limit=10`, token);
      feed = Array.isArray(f) ? f : f.data || [];
    }
  } catch (e) {
    error = e.message;
  }
  res.render('dashboard', { user: req.session.user, whoami, feed, error });
});

// --- Logout: czyszczenie sesji + RP-initiated logout w Keycloak ---
app.get('/logout', (req, res) => {
  const idToken = req.session.idToken;
  req.session.destroy(() => {
    const params = new URLSearchParams({ post_logout_redirect_uri: `http://localhost:${PORT}/` });
    if (idToken) params.set('id_token_hint', idToken);
    res.redirect(`${PUBLIC_REALM}/protocol/openid-connect/logout?${params.toString()}`);
  });
});

app.listen(PORT, () => {
  console.log(`[ssr-client] nasluchuje na http://localhost:${PORT}`);
});
