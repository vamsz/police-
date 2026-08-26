const Api = {
  base: '',

  token() {
    return localStorage.getItem('token');
  },

  user() {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  },

  setSession(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  },

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/index.html';
  },

  async request(path, { method = 'GET', body } = {}) {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token() ? { Authorization: `Bearer ${this.token()}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      this.logout();
      throw new Error('Session expired');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  // Loads the Google Maps JS API. Reports auth/network failures through onError
  // instead of leaving a blank grey map. Resolves true once Maps is ready.
  async loadMaps(onError) {
    let cfg;
    try {
      cfg = await this.request('/api/config');
    } catch {
      onError('Could not reach the server to read the Maps configuration.');
      return false;
    }
    if (!cfg.googleMapsApiKey) {
      onError('No Google Maps API key configured. Set GOOGLE_MAPS_API_KEY in backend/.env and restart the server.');
      return false;
    }

    // Google calls this when the key is rejected — often after the map object
    // already exists, so it must report independently of the promise below.
    window.gm_authFailure = () => onError(
      'Google rejected this Maps API key. In Google Cloud Console: link a billing account to the project, ' +
      'enable "Maps JavaScript API", and allow this site under the key\'s HTTP referrer restrictions.'
    );

    return new Promise((resolve) => {
      window.__onMapsReady = () => resolve(true);
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(cfg.googleMapsApiKey)}&callback=__onMapsReady`;
      script.async = true;
      script.onerror = () => {
        onError('Could not load Google Maps. Check the internet connection on this machine.');
        resolve(false);
      };
      document.head.appendChild(script);
    });
  },

  requireRole(role) {
    const u = this.user();
    if (!this.token() || !u || u.role !== role) {
      window.location.href = '/index.html';
    }
    return u;
  },
};
