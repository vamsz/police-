import { api } from '../core/api.js';
import { requireRole, signOut } from '../core/session.js';
import { $, el, render } from '../core/dom.js';
import { distance, relativeTime, statusInfo } from '../core/format.js';
import { loadMaps, DeploymentMap } from '../core/maps.js';

// requireRole redirects and returns null when the visitor is not signed in as
// this role; start() is invoked at the very bottom, once every declaration it
// closes over (state, classes) has been initialised.
const user = requireRole('officer');

async function start() {
  $('#officerName').textContent = user.name;
  $('#signOut').addEventListener('click', signOut);

  const view = new OfficerView();
  const config = await api.clientConfig().catch(() => ({ reportIntervalSeconds: 10 }));

  await view.initMap(config);
  await view.loadStanding();

  new PositionReporter({
    intervalSeconds: config.reportIntervalSeconds ?? 10,
    onPosition: (coords) => view.showOwnPosition(coords),
    onReport: (standing) => view.applyStanding(standing),
    onProblem: (problem) => view.showProblem(problem),
  }).start();

  // The supervisor can move this officer's post at any time, so the assignment
  // is refreshed even when the officer is standing still.
  setInterval(() => view.loadStanding().catch(() => {}), 30_000);
}

/** Everything that draws on screen for the officer. */
class OfficerView {
  #map = null;
  #assignment = null;
  #ownPosition = null;
  #lastReportedAt = null;
  #status = 'unassigned';

  async initMap(config) {
    const container = $('#map');

    if (!config.googleMapsApiKey) {
      render(
        container,
        el('div', { class: 'map__notice' }, [
          el('div', { class: 'map__notice-inner' }, [
            el('p', { text: 'The map is not configured, but your position is still being reported.' }),
            el('p', { text: 'Ask your administrator to set GOOGLE_MAPS_API_KEY on the server.' }),
          ]),
        ])
      );
      return;
    }

    try {
      const maps = await loadMaps(config.googleMapsApiKey);
      this.#map = new DeploymentMap(maps, container);
      $('#recentre').addEventListener('click', () => this.#recentre());
    } catch (err) {
      render(container, el('div', { class: 'map__notice' }, [el('p', { text: err.message })]));
    }
  }

  async loadStanding() {
    const standing = await api.standing();
    this.#assignment = standing.assignment;
    this.#renderAssignment();
    this.#syncMap();

    // Before the first report of this session, show what the server last knew.
    if (!this.#lastReportedAt && standing.lastFix) {
      $('#statDistance').textContent = distance(standing.lastFix.distanceMeters);
      $('#lastSent').textContent = `Last reported ${relativeTime(standing.lastFix.recordedAt)}`;
      this.#setBanner(standing.status);
    } else if (!this.#assignment) {
      this.#setBanner('unassigned');
    }
  }

  #renderAssignment() {
    const assignment = this.#assignment;

    $('#rallyName').textContent = assignment ? assignment.rallyName : 'No assignment yet';
    $('#statRadius').textContent = assignment ? distance(assignment.radiusMeters) : '—';

    const notes = $('#rallyNotes');
    notes.textContent = assignment?.notes ?? '';
    notes.hidden = !assignment?.notes;
  }

  showOwnPosition(coords) {
    this.#ownPosition = coords;
    $('#statAccuracy').textContent = coords.accuracy == null ? '—' : distance(coords.accuracy);
    this.#syncMap();
  }

  applyStanding(standing) {
    this.#assignment = standing.assignment;
    this.#lastReportedAt = standing.recordedAt;

    this.#renderAssignment();
    this.#setBanner(standing.status, standing);
    $('#statDistance').textContent = distance(standing.distanceMeters);
    $('#lastSent').textContent = `Reported ${relativeTime(standing.recordedAt)}`;
    this.#syncMap();
  }

  showProblem({ message, kind = 'warn' }) {
    const banner = $('#banner');
    banner.className = `banner banner--${kind}`;
    render(banner, message);
  }

  #setBanner(status, standing = null) {
    this.#status = status;
    const banner = $('#banner');
    const info = statusInfo(status);

    let text = info.label;
    if (status === 'outside' && standing?.metersOutside) {
      text = `Outside your assigned area — ${distance(standing.metersOutside)} beyond the boundary. Return to your post.`;
    } else if (status === 'on_post') {
      text = 'On post — within your assigned area.';
    } else if (status === 'unassigned') {
      text = 'No post assigned yet. Your position is being reported; wait for your assignment.';
    } else if (status === 'low_accuracy') {
      text = 'GPS signal is weak. Move into the open if you can.';
    }

    if (standing?.integrityFlags?.length) {
      text += ' Your location signal has been flagged for review.';
    }

    banner.className = `banner banner--${info.tone}`;
    render(banner, text);
  }

  /**
   * The officer sees exactly what the supervisor sees: their own marker, the
   * post, and the boundary. Reusing the roster shape keeps one rendering path.
   */
  #syncMap() {
    if (!this.#map) return;

    const marker = {
      id: user.id,
      name: user.name,
      status: this.#status,
      integrityFlagged: false,
      currentLat: this.#ownPosition?.latitude ?? null,
      currentLng: this.#ownPosition?.longitude ?? null,
      postLat: this.#assignment?.lat ?? null,
      postLng: this.#assignment?.lng ?? null,
      radiusMeters: this.#assignment?.radiusMeters ?? null,
    };

    this.#map.syncOfficers([marker]);
    this.#map.fitToContentOnce([marker]);
  }

  #recentre() {
    const point = this.#ownPosition
      ? { lat: this.#ownPosition.latitude, lng: this.#ownPosition.longitude }
      : this.#assignment
        ? { lat: this.#assignment.lat, lng: this.#assignment.lng }
        : null;
    if (point) this.#map?.panTo(point, 17);
  }
}

/**
 * Watches the device position and reports it on a fixed cadence.
 *
 * `watchPosition` can fire many times a second while a phone refines its fix.
 * Posting every one of those would flood the server and the officer's data plan,
 * so the newest fix is held and sent on a timer instead. A failed send is not
 * dropped: the next tick simply sends whatever the newest fix is by then, which
 * is what an operator actually wants to see after a signal drop.
 */
class PositionReporter {
  #intervalSeconds;
  #callbacks;
  #latest = null;
  #sending = false;
  #timer = null;

  constructor({ intervalSeconds, onPosition, onReport, onProblem }) {
    this.#intervalSeconds = intervalSeconds;
    this.#callbacks = { onPosition, onReport, onProblem };
  }

  start() {
    if (!navigator.geolocation) {
      this.#callbacks.onProblem({
        message: 'This device or browser cannot report location. Use a phone with GPS and a modern browser.',
        kind: 'critical',
      });
      return;
    }

    navigator.geolocation.watchPosition(
      (position) => {
        this.#latest = position;
        this.#callbacks.onPosition(position.coords);
        if (!this.#timer) this.#beginReporting();
      },
      (error) => this.#callbacks.onProblem(describeGeolocationError(error)),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 }
    );
  }

  #beginReporting() {
    this.#send();
    this.#timer = setInterval(() => this.#send(), this.#intervalSeconds * 1000);

    // A backgrounded phone throttles timers; report as soon as it wakes up.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.#send();
    });
  }

  async #send() {
    if (this.#sending || !this.#latest) return;
    this.#sending = true;

    const { coords, timestamp } = this.#latest;

    try {
      const standing = await api.reportFix({
        lat: coords.latitude,
        lng: coords.longitude,
        accuracyMeters: coords.accuracy ?? null,
        fixedAt: new Date(timestamp).toISOString(),
      });
      this.#callbacks.onReport(standing);
    } catch (err) {
      if (err.code === 'offline') {
        this.#callbacks.onProblem({
          message: 'No connection to the server. Your position will be sent when the signal returns.',
          kind: 'warn',
        });
      } else if (err.code !== 'rate_limited') {
        this.#callbacks.onProblem({ message: err.message, kind: 'warn' });
      }
    } finally {
      this.#sending = false;
    }
  }
}

function describeGeolocationError(error) {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return {
        message: 'Location permission is blocked. Allow location for this site in your browser settings, then reload.',
        kind: 'critical',
      };
    case error.POSITION_UNAVAILABLE:
      return { message: 'No GPS fix yet. Move into the open — buildings block satellite signal.', kind: 'warn' };
    case error.TIMEOUT:
      return { message: 'Taking longer than usual to get a GPS fix…', kind: 'warn' };
    default:
      return { message: `Location error: ${error.message}`, kind: 'warn' };
  }
}

if (user) start();
