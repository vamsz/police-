'use strict';

const { config } = require('../config');
const { withTransaction } = require('../db/pool');
const logger = require('../lib/logger');

const integrity = require('../domain/integrity');
const radius = require('../domain/radius');
const { STATUS, derive } = require('../domain/status');

const assignmentsRepo = require('../repositories/assignments.repo');
const locationsRepo = require('../repositories/locations.repo');
const alertsRepo = require('../repositories/alerts.repo');
const usersRepo = require('../repositories/users.repo');

const tracking = config.tracking;

/**
 * Ingests one position report and returns the officer's resulting standing.
 *
 * The whole unit of work runs in a transaction: a fix is never stored without
 * the alert bookkeeping it implies, and a breach can never be recorded twice by
 * two reports arriving together.
 */
async function recordFix({ userId, lat, lng, accuracyMeters, fixedAt }) {
  const receivedAt = new Date();

  return withTransaction(async (client) => {
    const assignment = await assignmentsRepo.findActiveForUser(userId, client);
    const lookback = Math.max(tracking.identicalFixThreshold, 5);
    const recentFixes = await locationsRepo.findRecentForUser(userId, lookback, client);
    const previous = recentFixes[0] ?? null;

    const integrityResult = integrity.evaluate({
      fix: { lat, lng, accuracyMeters, fixedAt, receivedAt },
      previous,
      recentFixes,
      options: tracking,
      now: receivedAt,
    });

    const radiusResult = radius.evaluate({ assignment, lat, lng, accuracyMeters }, tracking);

    await locationsRepo.insert(
      {
        userId,
        assignmentId: assignment?.id ?? null,
        lat,
        lng,
        accuracyMeters,
        speedMps: integrityResult.speedMps,
        distanceMeters: radiusResult.distanceMeters,
        outsideRadius: radiusResult.outsideRadius,
        integrityFlags: integrityResult.flags,
        fixedAt,
      },
      client
    );

    await applyIntegrityOutcome({ userId, integrityResult, assignment, client });
    await applyRadiusOutcome({ userId, radiusResult, assignment, client });

    // Any report at all means the officer is reachable again.
    await alertsRepo.resolveOpenForUser(
      userId,
      'signal_lost',
      { resolution: 'Position reporting resumed' },
      client
    );

    return buildStanding({ assignment, radiusResult, integrityResult, receivedAt });
  });
}

async function applyIntegrityOutcome({ userId, integrityResult, assignment, client }) {
  if (!integrityResult.flags.length) return;

  await usersRepo.setIntegrityFlag(userId, true, client);
  const alert = await alertsRepo.openOrTouch(
    {
      userId,
      assignmentId: assignment?.id ?? null,
      type: 'integrity',
      severity: 'critical',
      message: `Location signal looks unreliable: ${integrity.describe(integrityResult.flags)}`,
      details: { flags: integrityResult.flags, speedMps: integrityResult.speedMps },
    },
    client
  );

  if (alert.isNew) {
    logger.warn('Integrity alert opened', { userId, flags: integrityResult.flags });
  }
}

async function applyRadiusOutcome({ userId, radiusResult, assignment, client }) {
  if (!radiusResult.hasAssignment || !radiusResult.accuracyUsable) return;

  if (radiusResult.outsideRadius) {
    const away = Math.round(radiusResult.distanceMeters);
    const alert = await alertsRepo.openOrTouch(
      {
        userId,
        assignmentId: assignment.id,
        type: 'out_of_radius',
        severity: 'warning',
        message: `${away} m from assigned post (limit ${assignment.radiusMeters} m), heading ${radiusResult.compass}`,
        details: {
          distanceMeters: away,
          radiusMeters: assignment.radiusMeters,
          bearingDegrees: Math.round(radiusResult.bearingDegrees),
          compass: radiusResult.compass,
        },
      },
      client
    );
    if (alert.isNew) logger.warn('Officer left assigned area', { userId, distanceMeters: away });
    return;
  }

  const resolved = await alertsRepo.resolveOpenForUser(
    userId,
    'out_of_radius',
    { resolution: 'Officer returned to assigned area' },
    client
  );
  if (resolved) logger.info('Officer returned to post', { userId });
}

function buildStanding({ assignment, radiusResult, integrityResult, receivedAt }) {
  const status = derive({
    hasAssignment: Boolean(assignment),
    lastSeenAt: receivedAt,
    outsideRadius: radiusResult.outsideRadius,
    accuracyUsable: radiusResult.accuracyUsable !== false,
    signalLostAfterSeconds: tracking.signalLostAfterSeconds,
    now: receivedAt,
  });

  return {
    status,
    recordedAt: receivedAt.toISOString(),
    assignment: assignment
      ? {
          id: assignment.id,
          rallyName: assignment.rallyName,
          lat: assignment.lat,
          lng: assignment.lng,
          radiusMeters: assignment.radiusMeters,
          notes: assignment.notes,
        }
      : null,
    distanceMeters: radiusResult.distanceMeters == null ? null : Math.round(radiusResult.distanceMeters),
    metersOutside: radiusResult.metersOutside == null ? null : Math.round(radiusResult.metersOutside),
    compass: radiusResult.compass ?? null,
    accuracyUsable: radiusResult.accuracyUsable !== false,
    integrityFlags: integrityResult.flags,
  };
}

/** The officer's own view: their post plus their latest standing against it. */
async function currentStanding(userId) {
  const assignment = await assignmentsRepo.findActiveForUser(userId);
  const [latest] = await locationsRepo.findRecentForUser(userId, 1);

  const status = derive({
    hasAssignment: Boolean(assignment),
    lastSeenAt: latest?.recorded_at ?? null,
    outsideRadius: latest?.outsideRadius ?? false,
    signalLostAfterSeconds: tracking.signalLostAfterSeconds,
  });

  return {
    status,
    assignment: assignment
      ? {
          id: assignment.id,
          rallyName: assignment.rallyName,
          lat: assignment.lat,
          lng: assignment.lng,
          radiusMeters: assignment.radiusMeters,
          notes: assignment.notes,
          assignedAt: assignment.createdAt,
        }
      : null,
    lastFix: latest
      ? {
          lat: latest.lat,
          lng: latest.lng,
          accuracyMeters: latest.accuracyMeters,
          distanceMeters: latest.distanceMeters == null ? null : Math.round(latest.distanceMeters),
          outsideRadius: latest.outsideRadius,
          recordedAt: latest.recorded_at,
        }
      : null,
    reportIntervalSeconds: tracking.reportIntervalSeconds,
  };
}

module.exports = { recordFix, currentStanding, STATUS };
