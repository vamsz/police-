import { session, signOut } from './session.js';

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // A dead network is expected in the field, so it gets its own code rather
    // than surfacing as a confusing generic failure.
    throw new ApiError(0, 'offline', 'No connection to the server');
  }

  // An expired or revoked token means the stored session is worthless: clear it
  // rather than leaving the page half-working.
  if (response.status === 401) {
    signOut();
    throw new ApiError(401, 'unauthorized', 'Session expired');
  }

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(response.status, error.code ?? 'error', error.message ?? 'Request failed', error.details);
  }

  return payload;
}

export const api = {
  ApiError,

  login: (phone, password) => request('/api/auth/login', { method: 'POST', body: { phone, password } }),
  register: (details) => request('/api/auth/register', { method: 'POST', body: details }),
  clientConfig: () => request('/api/client-config'),

  // Officer
  standing: (signal) => request('/api/tracking/standing', { signal }),
  reportFix: (fix) => request('/api/tracking/fixes', { method: 'POST', body: fix }),

  // Admin
  officers: (signal) => request('/api/officers', { signal }),
  officer: (id) => request(`/api/officers/${id}`),
  rallyNames: () => request('/api/officers/meta/rally-names'),
  assign: (id, assignment) => request(`/api/officers/${id}/assignment`, { method: 'PUT', body: assignment }),
  endAssignment: (id) => request(`/api/officers/${id}/assignment`, { method: 'DELETE' }),
  setActive: (id, isActive) => request(`/api/officers/${id}/activation`, { method: 'PUT', body: { isActive } }),
  clearFlag: (id, note) => request(`/api/officers/${id}/clear-integrity-flag`, { method: 'POST', body: { note } }),
  alerts: (signal) => request('/api/alerts', { signal }),
  resolveAlert: (id, note) => request(`/api/alerts/${id}/resolve`, { method: 'POST', body: { note } }),
};
