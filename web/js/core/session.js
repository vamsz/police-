const TOKEN_KEY = 'rdt.token';
const USER_KEY = 'rdt.user';

/**
 * Where the signed-in identity lives. The token is the only credential; the
 * cached user object is a convenience for rendering and is never trusted for
 * authorisation, which the server decides on every request.
 */
export const session = {
  get token() {
    return localStorage.getItem(TOKEN_KEY);
  },

  get user() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY)) ?? null;
    } catch {
      return null;
    }
  },

  start(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  end() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },

  homePath() {
    return this.user?.role === 'admin' ? '/admin.html' : '/officer.html';
  },
};

/** Sends the browser to the sign-in page, ending the session on the way out. */
export function signOut() {
  session.end();
  window.location.href = '/index.html';
}

/**
 * Page guard. Returns the signed-in user, or redirects and returns null if the
 * visitor is not signed in as the required role.
 */
export function requireRole(role) {
  const user = session.user;
  if (!session.token || !user) {
    window.location.replace('/index.html');
    return null;
  }
  if (user.role !== role) {
    window.location.replace(session.homePath());
    return null;
  }
  return user;
}
