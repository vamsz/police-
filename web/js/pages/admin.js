import { api } from '../core/api.js';
import { requireRole, signOut } from '../core/session.js';
import { $, el, render } from '../core/dom.js';
import { distance, relativeTime, clockTime, statusInfo, alertLabel, initials } from '../core/format.js';
import { loadMaps, DeploymentMap } from '../core/maps.js';

// requireRole redirects and returns null when the visitor is not signed in as
// this role; start() is invoked at the very bottom, once every declaration it
// closes over (state, classes) has been initialised.
const user = requireRole('admin');

/**
 * Console state.
 *
 * `placement` is what fixed the assignment flow: the previous build put the
 * assignment form in a full-screen modal that sat on top of the map, so the
 * "click the map to choose a point" instruction could never be followed. Posting
 * an officer is now a mode of the side panel, and the map stays live throughout.
 */
const state = {
  officers: [],
  summary: {},
  alerts: [],
  selectedId: null,
  placement: null, // { officerId, point, radiusMeters, rallyName, notes }
  search: '',
  config: {},
  map: null,
};

async function start() {
  $('#adminName').textContent = user.name;
  $('#signOut').addEventListener('click', signOut);
  $('#search').addEventListener('input', (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderRoster();
  });

  state.config = await api.clientConfig().catch(() => ({}));
  await initMap();
  await refresh();

  // Polling pauses while the tab is hidden: an unattended console should not
  // keep hammering the server, and it catches up the moment it is looked at.
  const pollMs = (state.config.adminPollSeconds ?? 5) * 1000;
  setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, pollMs);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
}

async function initMap() {
  const container = $('#map');

  if (!state.config.googleMapsApiKey) {
    render(
      container,
      el('div', { class: 'map__notice' }, [
        el('div', { class: 'map__notice-inner' }, [
          el('h2', { text: 'Map not configured' }),
          el('p', {
            text: 'Officer positions are still being tracked and listed, but there is no map to show them on.',
          }),
          el('p', [
            'Set ',
            el('code', { text: 'GOOGLE_MAPS_API_KEY' }),
            ' in the server’s .env file and restart it.',
          ]),
        ]),
      ])
    );
    return;
  }

  try {
    const maps = await loadMaps(state.config.googleMapsApiKey);
    state.map = new DeploymentMap(maps, container, { view: state.config.map, onMapClick: handleMapClick });
  } catch (err) {
    render(container, el('div', { class: 'map__notice' }, [el('p', { text: err.message })]));
  }
}

async function refresh() {
  try {
    const [roster, alerts] = await Promise.all([api.officers(), api.alerts()]);
    state.officers = roster.officers;
    state.summary = roster.summary;
    state.alerts = alerts.alerts;
  } catch (err) {
    if (err.code === 'offline') {
      $('#refreshedAt').textContent = 'Connection lost — retrying';
      return;
    }
    throw err;
  }

  $('#refreshedAt').textContent = `Updated ${clockTime(new Date())}`;

  renderSummary();
  renderRoster();
  renderAlerts();
  // Never rebuild the detail panel mid-placement: it would wipe out whatever the
  // supervisor is typing. The readout updates itself instead.
  if (state.selectedId && !state.placement) renderDetail();

  state.map?.syncOfficers(state.officers, { onSelect: selectOfficer, selectedId: state.selectedId });
  // Keep officers clear of the floating panel (left) and header (top).
  state.map?.fitToContentOnce(state.officers, { left: 372, top: 96, right: 40, bottom: 40 });
}

/* ------------------------------------------------------------------ roster */

function renderSummary() {
  const { total = 0, onPost = 0, outside = 0, noSignal = 0 } = state.summary;
  const cells = [
    { label: 'Officers', value: total, modifier: '' },
    { label: 'On post', value: onPost, modifier: 'onpost' },
    { label: 'Outside', value: outside, modifier: 'outside' },
    { label: 'No signal', value: noSignal, modifier: 'nosignal' },
  ];

  render(
    $('#summary'),
    cells.map((cell) =>
      el('div', { class: `summary__cell${cell.modifier ? ` summary__cell--${cell.modifier}` : ''}` }, [
        el('div', { class: 'summary__value', text: String(cell.value) }),
        el('div', { class: 'summary__label', text: cell.label }),
      ])
    )
  );
}

function matchesSearch(officer) {
  if (!state.search) return true;
  return [officer.name, officer.badgeId, officer.rallyName]
    .filter(Boolean)
    .some((field) => field.toLowerCase().includes(state.search));
}

function renderRoster() {
  const visible = state.officers.filter(matchesSearch);
  $('#rosterCount').textContent = `${visible.length}`;

  if (!visible.length) {
    render($('#roster'), el('div', { class: 'empty', text: state.officers.length ? 'No match.' : 'No officers registered yet.' }));
    return;
  }

  render($('#roster'), visible.map(rosterRow));
}

function rosterRow(officer) {
  const info = statusInfo(officer.status);

  const meta = officer.rallyName
    ? `${officer.rallyName} · ${relativeTime(officer.lastSeenAt)}`
    : 'No post assigned';

  return el(
    'button',
    {
      type: 'button',
      class: 'roster__item',
      'aria-current': String(state.selectedId === officer.id),
      onClick: () => selectOfficer(officer.id),
    },
    [
      el('div', { class: `avatar${officer.isActive ? '' : ' avatar--muted'}`, text: initials(officer.name) }),
      el('div', { class: 'roster__body' }, [
        el('div', { class: 'roster__name' }, [
          officer.name,
          !officer.isActive ? ' (deactivated)' : null,
        ]),
        el('div', { class: 'roster__meta', text: meta }),
      ]),
      el('div', { class: 'roster__right' }, [
        el('span', { class: `pill pill--${info.tone}`, text: info.label }),
        officer.integrityFlagged ? el('span', { class: 'pill pill--flag', text: 'Flagged' }) : null,
        officer.distanceMeters != null && officer.postLat != null
          ? el('span', { class: 'roster__distance', text: distance(officer.distanceMeters) })
          : null,
      ]),
    ]
  );
}

/* ------------------------------------------------------------------ alerts */

function renderAlerts() {
  $('#alertCount').textContent = state.alerts.length ? String(state.alerts.length) : '';

  if (!state.alerts.length) {
    render($('#alerts'), el('div', { class: 'empty', text: 'Nothing needs attention.' }));
    return;
  }

  render($('#alerts'), state.alerts.map(alertRow));
}

function alertRow(alert) {
  return el('div', { class: `alert${alert.severity === 'critical' ? ' alert--critical' : ''}` }, [
    el('div', { class: 'alert__head' }, [
      el('span', { class: 'alert__who', text: alert.officerName }),
      el('span', { class: 'alert__when', text: relativeTime(alert.lastSeenAt) }),
    ]),
    el('div', { class: 'alert__what' }, [
      el('strong', { text: `${alertLabel(alert.type)}: ` }),
      alert.message,
    ]),
    el('div', { class: 'alert__foot' }, [
      el('button', {
        type: 'button',
        class: 'btn btn--sm',
        text: 'Show',
        onClick: () => selectOfficer(alert.userId),
      }),
      el('button', {
        type: 'button',
        class: 'btn btn--sm',
        text: 'Resolve',
        onClick: (event) => resolveAlert(alert, event.currentTarget),
      }),
      alert.occurrences > 1
        ? el('span', { class: 'alert__count', text: `seen ${alert.occurrences}×` })
        : null,
    ]),
  ]);
}

async function resolveAlert(alert, button) {
  button.disabled = true;
  try {
    await api.resolveAlert(alert.id);
    await refresh();
  } catch (err) {
    button.disabled = false;
    window.alert(err.message);
  }
}

/* ------------------------------------------------------------------ detail */

function selectOfficer(officerId) {
  state.selectedId = officerId;
  cancelPlacement();
  renderDetail();
  renderRoster();

  const officer = findOfficer(officerId);
  const focus = officer?.currentLat != null
    ? { lat: officer.currentLat, lng: officer.currentLng }
    : officer?.postLat != null
      ? { lat: officer.postLat, lng: officer.postLng }
      : null;
  if (focus) state.map?.panTo(focus, 16);

  state.map?.syncOfficers(state.officers, { onSelect: selectOfficer, selectedId: state.selectedId });
}

function closeDetail() {
  state.selectedId = null;
  cancelPlacement();
  $('#detailMode').hidden = true;
  $('#rosterMode').hidden = false;
  renderRoster();
  state.map?.syncOfficers(state.officers, { onSelect: selectOfficer, selectedId: null });
}

const findOfficer = (id) => state.officers.find((officer) => officer.id === id) ?? null;

function renderDetail() {
  const officer = findOfficer(state.selectedId);
  if (!officer) return closeDetail();

  $('#rosterMode').hidden = true;
  const panel = $('#detailMode');
  panel.hidden = false;

  const info = statusInfo(officer.status);

  render(
    panel,
    el('div', { class: 'detail__header' }, [
      el('button', { type: 'button', class: 'detail__back', text: '←', title: 'Back to roster', onClick: closeDetail }),
      el('div', { class: `avatar avatar--lg${officer.isActive ? '' : ' avatar--muted'}`, text: initials(officer.name) }),
      el('div', { class: 'detail__identity' }, [
        el('div', { class: 'detail__name', text: officer.name }),
        el('div', { class: 'detail__badge', text: officer.badgeId ? `Badge ${officer.badgeId}` : 'No badge on file' }),
      ]),
      el('span', { class: `pill pill--${info.tone}`, text: info.label }),
    ]),
    contactSection(officer),
    officer.integrityFlagged ? integritySection(officer) : null,
    state.placement?.officerId === officer.id ? placementSection(officer) : postSection(officer),
    accountSection(officer)
  );
}

function contactSection(officer) {
  return el('div', { class: 'detail__section' }, [
    el('dl', { class: 'facts' }, [
      el('dt', { text: 'Phone' }),
      el('dd', [el('a', { href: `tel:${officer.phone}`, text: officer.phone })]),
      el('dt', { text: 'Email' }),
      el('dd', officer.email ? [el('a', { href: `mailto:${officer.email}`, text: officer.email })] : ['—']),
      el('dt', { text: 'Last seen' }),
      el('dd', { text: relativeTime(officer.lastSeenAt) }),
      el('dt', { text: 'GPS accuracy' }),
      el('dd', { text: officer.accuracyMeters != null ? distance(officer.accuracyMeters) : '—' }),
    ]),
  ]);
}

function integritySection(officer) {
  return el('div', { class: 'detail__section' }, [
    el('div', { class: 'message message--error' }, [
      el('strong', { text: 'Location signal flagged. ' }),
      'Automated checks found this officer’s reports implausible. Confirm their position by radio before relying on the map.',
    ]),
    el('button', {
      type: 'button',
      class: 'btn btn--block',
      text: 'Clear flag after review',
      onClick: async (event) => {
        event.currentTarget.disabled = true;
        await api.clearFlag(officer.id).catch((err) => window.alert(err.message));
        await refresh();
      },
    }),
  ]);
}

function postSection(officer) {
  const hasPost = officer.assignmentId != null;

  return el('div', { class: 'detail__section' }, [
    el('h3', { class: 'section-title', style: { padding: '0 0 0.5rem' } }, ['Assigned post']),

    hasPost
      ? el('dl', { class: 'facts' }, [
          el('dt', { text: 'Rally' }),
          el('dd', { text: officer.rallyName }),
          el('dt', { text: 'Radius' }),
          el('dd', { text: distance(officer.radiusMeters) }),
          el('dt', { text: 'Distance' }),
          el('dd', { text: officer.distanceMeters != null ? distance(officer.distanceMeters) : 'No position yet' }),
          el('dt', { text: 'Assigned' }),
          el('dd', { text: relativeTime(officer.assignedAt) }),
          ...(officer.assignmentNotes ? [el('dt', { text: 'Notes' }), el('dd', { text: officer.assignmentNotes })] : []),
        ])
      : el('p', { class: 'field__hint', style: { marginTop: '0' }, text: 'This officer has no post yet.' }),

    el('div', { class: 'btn-row', style: { marginTop: '0.85rem' } }, [
      el('button', {
        type: 'button',
        class: 'btn btn--primary',
        text: hasPost ? 'Move post' : 'Assign post',
        onClick: () => beginPlacement(officer),
      }),
      hasPost
        ? el('button', {
            type: 'button',
            class: 'btn btn--danger',
            text: 'Stand down',
            onClick: async (event) => {
              if (!window.confirm(`End ${officer.name}'s assignment?`)) return;
              event.currentTarget.disabled = true;
              await api.endAssignment(officer.id).catch((err) => window.alert(err.message));
              await refresh();
            },
          })
        : null,
    ]),
  ]);
}

function accountSection(officer) {
  return el('div', { class: 'detail__section' }, [
    el('button', {
      type: 'button',
      class: `btn btn--block${officer.isActive ? ' btn--danger' : ''}`,
      text: officer.isActive ? 'Deactivate account' : 'Reactivate account',
      onClick: async (event) => {
        const verb = officer.isActive ? 'Deactivate' : 'Reactivate';
        if (!window.confirm(`${verb} ${officer.name}'s account?`)) return;
        event.currentTarget.disabled = true;
        await api.setActive(officer.id, !officer.isActive).catch((err) => window.alert(err.message));
        await refresh();
      },
    }),
    el('p', {
      class: 'field__hint',
      text: officer.isActive
        ? 'A deactivated officer is signed out immediately and cannot sign back in.'
        : 'This account cannot sign in until it is reactivated.',
    }),
  ]);
}

/* --------------------------------------------------------------- placement */

function beginPlacement(officer) {
  state.placement = {
    officerId: officer.id,
    point: officer.postLat != null ? { lat: officer.postLat, lng: officer.postLng } : null,
    radiusMeters: officer.radiusMeters ?? state.config.defaultRadiusMeters ?? 75,
    rallyName: officer.rallyName ?? '',
    notes: officer.assignmentNotes ?? '',
  };

  if (state.placement.point) {
    state.map?.showPlacement(state.placement.point, state.placement.radiusMeters, onPlacementMoved);
    state.map?.panTo(state.placement.point, 17);
  }

  renderDetail();
}

function cancelPlacement() {
  if (!state.placement) return;
  state.placement = null;
  state.map?.clearPlacement();
}

function handleMapClick(point) {
  if (!state.placement) return;
  state.placement.point = point;
  state.map.showPlacement(point, state.placement.radiusMeters, onPlacementMoved);
  updatePlacementReadout();
}

function onPlacementMoved(point) {
  if (!state.placement) return;
  state.placement.point = point;
  updatePlacementReadout();
}

/**
 * Updates only the coordinate readout and the save button while a point is being
 * dragged. Re-rendering the whole panel here would tear the form out from under
 * whatever the supervisor was typing.
 */
function updatePlacementReadout() {
  const readout = $('#placementCoords');
  const save = $('#placementSave');
  const point = state.placement?.point;

  if (readout) {
    readout.textContent = point ? `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` : 'No point chosen yet';
  }
  if (save) save.disabled = !point;
}

function placementSection(officer) {
  const placement = state.placement;

  const rallyInput = el('input', {
    type: 'text',
    id: 'placementRally',
    value: placement.rallyName,
    placeholder: 'e.g. MG Road Rally',
    maxLength: 120,
    onInput: (event) => {
      placement.rallyName = event.target.value;
    },
  });

  const radiusOutput = el('output', { text: distance(placement.radiusMeters) });
  const radiusInput = el('input', {
    type: 'range',
    min: '10',
    max: '1000',
    step: '5',
    value: String(placement.radiusMeters),
    onInput: (event) => {
      placement.radiusMeters = Number(event.target.value);
      radiusOutput.textContent = distance(placement.radiusMeters);
      state.map?.setPlacementRadius(placement.radiusMeters);
    },
  });

  const notesInput = el('input', {
    type: 'text',
    value: placement.notes,
    placeholder: 'Optional instructions for this post',
    maxLength: 500,
    onInput: (event) => {
      placement.notes = event.target.value;
    },
  });

  const save = el('button', {
    type: 'button',
    id: 'placementSave',
    class: 'btn btn--primary',
    text: 'Save post',
    disabled: !placement.point,
    onClick: (event) => savePlacement(officer, event.currentTarget),
  });

  return el('div', { class: 'detail__section' }, [
    el('h3', { class: 'section-title', style: { padding: '0 0 0.5rem' } }, ['Place post']),

    el('p', { class: 'placement__prompt' }, [
      placement.point
        ? 'Drag the purple marker to fine-tune, or click elsewhere on the map to move it.'
        : 'Click anywhere on the map to drop this officer’s surveillance point.',
    ]),

    el('div', { class: 'field' }, [
      el('label', { text: 'Coordinates' }),
      el('div', {
        class: 'placement__coords',
        id: 'placementCoords',
        text: placement.point
          ? `${placement.point.lat.toFixed(6)}, ${placement.point.lng.toFixed(6)}`
          : 'No point chosen yet',
      }),
    ]),

    el('div', { class: 'field' }, [el('label', { text: 'Rally / area name' }), rallyInput]),

    el('div', { class: 'field' }, [
      el('label', { text: 'Allowed radius' }),
      el('div', { class: 'radius-row' }, [radiusInput, radiusOutput]),
      el('p', {
        class: 'field__hint',
        text: 'Keep this comfortably larger than phone GPS accuracy — under about 50 m, ordinary drift will look like a breach.',
      }),
    ]),

    el('div', { class: 'field' }, [el('label', { text: 'Notes' }), notesInput]),

    el('div', { id: 'placementError', class: 'message message--error', hidden: true }),

    el('div', { class: 'btn-row' }, [
      save,
      el('button', {
        type: 'button',
        class: 'btn',
        text: 'Cancel',
        onClick: () => {
          cancelPlacement();
          renderDetail();
        },
      }),
    ]),
  ]);
}

async function savePlacement(officer, button) {
  const placement = state.placement;
  const errorBox = $('#placementError');
  const fail = (message) => {
    errorBox.textContent = message;
    errorBox.hidden = false;
    button.disabled = false;
    button.textContent = 'Save post';
  };

  if (!placement?.point) return;

  const rallyName = placement.rallyName.trim();
  if (rallyName.length < 2) return fail('Give the rally or area a name.');

  errorBox.hidden = true;
  button.disabled = true;
  button.textContent = 'Saving…';

  try {
    await api.assign(officer.id, {
      rallyName,
      lat: placement.point.lat,
      lng: placement.point.lng,
      radiusMeters: placement.radiusMeters,
      notes: placement.notes.trim() || undefined,
    });
    cancelPlacement();
    await refresh();
    renderDetail();
  } catch (err) {
    fail(err.message);
  }
}

if (user) start();
