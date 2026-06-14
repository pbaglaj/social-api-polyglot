import { WebStorageStateStore } from 'oidc-client-ts';
import type { AuthProviderProps } from 'react-oidc-context';
import { KC_AUTHORITY, KC_CLIENT_ID } from './config';

// Authorization Code + PKCE (S256). spa-client jest klientem publicznym (bez sekretu),
// wiec PKCE jest wymagane przez Keycloak. Tokeny trzymamy w localStorage, zeby przetrwaly
// odswiezenie strony.
export const oidcConfig: AuthProviderProps = {
  authority: KC_AUTHORITY,
  client_id: KC_CLIENT_ID,
  redirect_uri: window.location.origin + '/',
  post_logout_redirect_uri: window.location.origin + '/',
  response_type: 'code',
  scope: 'openid profile email',
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  // Po powrocie z Keycloak usuwamy ?code&state z paska adresu.
  onSigninCallback: () => {
    window.history.replaceState({}, document.title, window.location.pathname);
  },
};
