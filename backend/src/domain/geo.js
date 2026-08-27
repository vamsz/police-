'use strict';

const EARTH_RADIUS_M = 6_371_008.8; // IUGG mean radius

const toRadians = (degrees) => (degrees * Math.PI) / 180;
const toDegrees = (radians) => (radians * 180) / Math.PI;

/** Great-circle distance in metres between two WGS84 points. */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial bearing in degrees (0-360, clockwise from north) from point 1 to point 2. */
function bearingDegrees(lat1, lng1, lat2, lng2) {
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δλ = toRadians(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Bearing as an eight-point compass label, for human-readable guidance. */
function compassPoint(bearing) {
  return COMPASS_POINTS[Math.round(bearing / 45) % 8];
}

module.exports = { distanceMeters, bearingDegrees, compassPoint, EARTH_RADIUS_M };
