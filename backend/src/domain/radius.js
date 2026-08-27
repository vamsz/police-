'use strict';

const { distanceMeters, bearingDegrees, compassPoint } = require('./geo');

/**
 * Decides whether a fix places an officer outside their assigned post.
 *
 * A raw `distance > radius` test alerts constantly, because urban GPS accuracy
 * (10-30 m, worse beside buildings) is often larger than the post radius itself.
 * We therefore subtract the reported accuracy from the measured distance before
 * judging, giving the officer the benefit of the doubt about where they actually
 * are. The grace is capped so a very vague fix cannot excuse any distance, and a
 * fix vaguer than `maxUsableAccuracyMeters` is treated as unusable evidence: it
 * is recorded but never used to open a breach.
 */
function evaluate({ assignment, lat, lng, accuracyMeters }, options) {
  if (!assignment) {
    return { hasAssignment: false, outsideRadius: false, distanceMeters: null };
  }

  const distance = distanceMeters(assignment.lat, assignment.lng, lat, lng);
  const grace = Math.min(Math.max(accuracyMeters ?? 0, 0), options.accuracyGraceCapMeters);
  const confidentDistance = Math.max(0, distance - grace);
  const accuracyUsable = (accuracyMeters ?? 0) <= options.maxUsableAccuracyMeters;

  const bearing = bearingDegrees(assignment.lat, assignment.lng, lat, lng);

  return {
    hasAssignment: true,
    distanceMeters: distance,
    confidentDistanceMeters: confidentDistance,
    radiusMeters: assignment.radiusMeters,
    metersOutside: Math.max(0, distance - assignment.radiusMeters),
    accuracyUsable,
    outsideRadius: accuracyUsable && confidentDistance > assignment.radiusMeters,
    bearingDegrees: bearing,
    compass: compassPoint(bearing),
  };
}

module.exports = { evaluate };
