/** Google Maps loading and the deployment map layer, kept away from page logic. */

const CALLBACK = '__rdtMapsReady';
let loader = null;

/** Loads the Maps SDK once per page, no matter how many callers ask for it. */
export function loadMaps(apiKey) {
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    window[CALLBACK] = () => resolve(window.google.maps);

    const script = document.createElement('script');
    // loading=async is Google's recommended pattern and silences the console
    // warning; the callback still fires once the SDK is ready.
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=${CALLBACK}&loading=async&v=weekly`;
    script.async = true;
    script.onerror = () => reject(new Error('Could not load Google Maps. Check the API key and its restrictions.'));
    document.head.append(script);
  });

  return loader;
}

const COLORS = {
  on_post: '#16a34a',
  outside: '#dc2626',
  low_accuracy: '#c2740a',
  stale: '#c2740a',
  no_signal: '#a6abb3',
  unassigned: '#a6abb3',
  post: '#101114', // ink, matching the brand
  zone: '#ffd028', // amber safe-zone fill
  placement: '#2563eb', // blue, distinct from the amber zone being placed
};

function svgIcon(maps, markup, { width, height, anchorX, anchorY }) {
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(markup)}`,
    scaledSize: new maps.Size(width, height),
    anchor: new maps.Point(anchorX, anchorY),
  };
}

function officerIcon(maps, status, flagged) {
  const color = COLORS[status] ?? COLORS.no_signal;
  const ring = flagged
    ? '<circle cx="14" cy="14" r="12" fill="none" stroke="#6a1b9a" stroke-width="3"/>'
    : '';
  const markup =
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">' +
    `<path d="M14 39C14 39 27 23.6 27 14A13 13 0 1 0 1 14c0 9.6 13 25 13 25z" fill="${color}" stroke="#ffffff" stroke-width="2"/>` +
    '<circle cx="14" cy="14" r="5" fill="#ffffff"/>' +
    ring +
    '</svg>';
  return svgIcon(maps, markup, { width: 28, height: 40, anchorX: 14, anchorY: 39 });
}

function postIcon(maps, color = COLORS.post) {
  const markup =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">' +
    `<circle cx="10" cy="10" r="8" fill="#ffffff" fill-opacity="0.85" stroke="${color}" stroke-width="2.5"/>` +
    `<circle cx="10" cy="10" r="2.5" fill="${color}"/>` +
    '</svg>';
  return svgIcon(maps, markup, { width: 20, height: 20, anchorX: 10, anchorY: 10 });
}

/**
 * Owns every overlay on the map and reconciles them against the latest roster.
 *
 * Markers are updated in place rather than rebuilt on each poll, so the map does
 * not flicker every few seconds and the browser is not left leaking detached
 * overlays for officers who have gone off duty.
 */
export class DeploymentMap {
  #maps;
  #map;
  #layers = new Map();
  #placement = null;
  #hasFitted = false;

  constructor(maps, container, { center, view = {}, onMapClick } = {}) {
    this.#maps = maps;

    // Google's tiles are light, so the pre-load ground is a neutral map grey
    // (what Google itself shows) rather than the dark theme colour — that keeps
    // the transition to tiles smooth instead of a bright flash on a dark panel.
    const backgroundColor = '#e5e3df';

    this.#map = new maps.Map(container, {
      center: center ?? view.defaultCenter ?? { lat: 12.9716, lng: 77.5946 },
      zoom: center ? 15 : view.defaultZoom ?? 12,
      // Zoom-out is left open (see MAP_MIN_ZOOM); the loading chip and neutral
      // ground colour keep a wide, tile-heavy view feeling smooth rather than blank.
      minZoom: view.minZoom ?? 3,
      maxZoom: view.maxZoom ?? 20,
      backgroundColor,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
      gestureHandling: 'greedy',
      // Keep controls clear of the floating cards.
      zoomControlOptions: { position: maps.ControlPosition.RIGHT_BOTTOM },
    });

    this.#attachLoadingIndicator(container);

    if (onMapClick) {
      this.#map.addListener('click', (event) => {
        onMapClick({ lat: event.latLng.lat(), lng: event.latLng.lng() });
      });
    }
  }

  /**
   * A small "Loading map…" chip that shows until the first tiles paint, so a
   * slow tile load reads as progress rather than a broken blank map.
   */
  #attachLoadingIndicator(container) {
    const chip = document.createElement('div');
    chip.className = 'map-loading';
    chip.textContent = 'Loading map…';
    container.appendChild(chip);

    let cleared = false;
    const clear = () => {
      if (cleared) return;
      cleared = true;
      chip.classList.add('map-loading--done');
      setTimeout(() => chip.remove(), 400);
    };

    this.#maps.event.addListenerOnce(this.#map, 'tilesloaded', clear);
    // Fallback: never leave the chip up forever if tiles are throttled/blocked.
    setTimeout(clear, 8000);
  }

  get map() {
    return this.#map;
  }

  /** Adds, updates, and removes overlays so they match `officers` exactly. */
  syncOfficers(officers, { onSelect, selectedId = null } = {}) {
    const seen = new Set();

    for (const officer of officers) {
      seen.add(officer.id);
      const layer = this.#layers.get(officer.id) ?? this.#createLayer(officer, onSelect);
      this.#updateLayer(layer, officer, selectedId === officer.id);
    }

    for (const [id, layer] of this.#layers) {
      if (!seen.has(id)) {
        this.#destroyLayer(layer);
        this.#layers.delete(id);
      }
    }
  }

  #createLayer(officer, onSelect) {
    const maps = this.#maps;
    const layer = {
      officer: new maps.Marker({ map: this.#map, title: officer.name, zIndex: 20 }),
      post: new maps.Marker({ map: null, icon: postIcon(maps), zIndex: 10, title: 'Assigned post' }),
      radius: new maps.Circle({
        map: null,
        strokeColor: COLORS.post,
        strokeOpacity: 0.7,
        strokeWeight: 1.5,
        fillColor: COLORS.zone,
        fillOpacity: 0.18,
        clickable: false,
      }),
      leash: new maps.Polyline({
        map: null,
        strokeColor: COLORS.outside,
        strokeOpacity: 0,
        strokeWeight: 2,
        clickable: false,
        icons: [
          {
            icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, strokeColor: COLORS.outside, scale: 3 },
            offset: '0',
            repeat: '12px',
          },
        ],
      }),
    };

    if (onSelect) layer.officer.addListener('click', () => onSelect(officer.id));
    this.#layers.set(officer.id, layer);
    return layer;
  }

  #updateLayer(layer, officer, isSelected) {
    const maps = this.#maps;
    const hasPost = officer.postLat != null;
    const hasFix = officer.currentLat != null;

    if (hasFix) {
      layer.officer.setPosition({ lat: officer.currentLat, lng: officer.currentLng });
      layer.officer.setIcon(officerIcon(maps, officer.status, officer.integrityFlagged));
      layer.officer.setZIndex(isSelected ? 60 : 20);
      layer.officer.setMap(this.#map);
    } else {
      layer.officer.setMap(null);
    }

    if (hasPost) {
      const post = { lat: officer.postLat, lng: officer.postLng };
      layer.post.setPosition(post);
      layer.post.setMap(this.#map);
      layer.radius.setCenter(post);
      layer.radius.setRadius(officer.radiusMeters);
      layer.radius.setOptions(
        isSelected
          ? { strokeOpacity: 1, strokeWeight: 2.5, fillOpacity: 0.28 }
          : { strokeOpacity: 0.7, strokeWeight: 1.5, fillOpacity: 0.18 }
      );
      layer.radius.setMap(this.#map);
    } else {
      layer.post.setMap(null);
      layer.radius.setMap(null);
    }

    // A dashed line to the post makes it obvious at a glance how far an officer
    // has drifted, and in which direction.
    if (hasPost && hasFix && officer.status === 'outside') {
      layer.leash.setPath([
        { lat: officer.currentLat, lng: officer.currentLng },
        { lat: officer.postLat, lng: officer.postLng },
      ]);
      layer.leash.setMap(this.#map);
    } else {
      layer.leash.setMap(null);
    }
  }

  #destroyLayer(layer) {
    for (const overlay of Object.values(layer)) overlay.setMap(null);
  }

  /** A draggable proposed post with a live radius preview, before it is saved. */
  showPlacement({ lat, lng }, radiusMeters, onMove) {
    const maps = this.#maps;

    if (!this.#placement) {
      this.#placement = {
        marker: new maps.Marker({
          map: this.#map,
          draggable: true,
          icon: postIcon(maps, COLORS.placement),
          zIndex: 100,
          title: 'Drag to fine-tune this post',
        }),
        circle: new maps.Circle({
          map: this.#map,
          strokeColor: COLORS.placement,
          strokeOpacity: 1,
          strokeWeight: 2,
          fillColor: COLORS.placement,
          fillOpacity: 0.12,
          clickable: false,
        }),
      };

      this.#placement.marker.addListener('drag', (event) => {
        const point = { lat: event.latLng.lat(), lng: event.latLng.lng() };
        this.#placement.circle.setCenter(point);
        onMove?.(point);
      });
    }

    this.#placement.marker.setPosition({ lat, lng });
    this.#placement.circle.setCenter({ lat, lng });
    this.#placement.circle.setRadius(radiusMeters);
  }

  setPlacementRadius(radiusMeters) {
    this.#placement?.circle.setRadius(radiusMeters);
  }

  clearPlacement() {
    if (!this.#placement) return;
    this.#placement.marker.setMap(null);
    this.#placement.circle.setMap(null);
    this.#placement = null;
  }

  panTo(point, zoom) {
    this.#map.panTo(point);
    if (zoom) this.#map.setZoom(Math.max(this.#map.getZoom(), zoom));
  }

  /**
   * Frames everything on screen, but only the first time. Refitting on every
   * poll would yank the map out from under an operator who has panned somewhere.
   */
  fitToContentOnce(officers, padding) {
    if (this.#hasFitted) return;

    const bounds = new this.#maps.LatLngBounds();
    let points = 0;

    for (const officer of officers) {
      if (officer.postLat != null) {
        bounds.extend({ lat: officer.postLat, lng: officer.postLng });
        points += 1;
      }
      if (officer.currentLat != null) {
        bounds.extend({ lat: officer.currentLat, lng: officer.currentLng });
        points += 1;
      }
    }

    if (!points) return;
    this.#hasFitted = true;

    // The floating panel and sheet overlap the map, so the fit is padded to keep
    // officers in the part of the map that is actually visible, not hidden behind
    // the chrome. fitBounds honours a {top,right,bottom,left} padding directly;
    // for the single-point path we recentre with an equivalent pixel offset.
    const pad = { top: 90, right: 40, bottom: 40, left: 40, ...(padding || {}) };

    if (points === 1) {
      this.#map.setCenter(bounds.getCenter());
      this.#map.setZoom(16);
      this.#maps.event.addListenerOnce(this.#map, 'idle', () => {
        this.#map.panBy((pad.right - pad.left) / 2, (pad.bottom - pad.top) / 2);
      });
    } else {
      this.#map.fitBounds(bounds, pad);
    }
  }
}

export { COLORS };
