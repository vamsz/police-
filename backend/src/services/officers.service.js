'use strict';

const { config } = require('../config');
const AppError = require('../lib/AppError');
const { derive } = require('../domain/status');

const usersRepo = require('../repositories/users.repo');
const locationsRepo = require('../repositories/locations.repo');
const alertsRepo = require('../repositories/alerts.repo');
const assignmentsRepo = require('../repositories/assignments.repo');

const tracking = config.tracking;

function statusFor(row, now) {
  return derive({
    hasAssignment: Boolean(row.assignmentId),
    lastSeenAt: row.lastSeenAt,
    outsideRadius: row.outsideRadius ?? false,
    accuracyUsable: (row.accuracyMeters ?? 0) <= tracking.maxUsableAccuracyMeters,
    signalLostAfterSeconds: tracking.signalLostAfterSeconds,
    now,
  });
}

/** The console's roster: every officer, their post, their latest fix, their status. */
async function listWithStatus() {
  const now = new Date();
  const rows = await usersRepo.listOfficersWithStatus();

  const officers = rows.map((row) => ({
    ...row,
    distanceMeters: row.distanceMeters == null ? null : Math.round(row.distanceMeters),
    accuracyMeters: row.accuracyMeters == null ? null : Math.round(row.accuracyMeters),
    status: statusFor(row, now),
  }));

  return { officers, summary: summarise(officers) };
}

function summarise(officers) {
  const counts = { total: officers.length, onPost: 0, outside: 0, noSignal: 0, unassigned: 0, flagged: 0 };
  for (const officer of officers) {
    if (officer.integrityFlagged) counts.flagged += 1;
    if (officer.status === 'on_post' || officer.status === 'low_accuracy') counts.onPost += 1;
    else if (officer.status === 'outside') counts.outside += 1;
    else if (officer.status === 'unassigned') counts.unassigned += 1;
    else counts.noSignal += 1;
  }
  return counts;
}

/** Full detail for one officer, including recent movement for the map trail. */
async function getProfile(officerId, { trailMinutes = 60 } = {}) {
  const officer = await usersRepo.findOfficerById(officerId);
  if (!officer) throw AppError.notFound('No such officer');

  const since = new Date(Date.now() - trailMinutes * 60_000);
  const [assignment, trail, alerts, recent] = await Promise.all([
    assignmentsRepo.findActiveForUser(officerId),
    locationsRepo.findTrailForUser(officerId, { since }),
    alertsRepo.listForUser(officerId, { limit: 20 }),
    locationsRepo.findRecentForUser(officerId, 1),
  ]);

  const latest = recent[0] ?? null;

  return {
    officer,
    assignment,
    trail,
    alerts,
    lastFix: latest
      ? {
          lat: latest.lat,
          lng: latest.lng,
          accuracyMeters: latest.accuracyMeters,
          distanceMeters: latest.distanceMeters == null ? null : Math.round(latest.distanceMeters),
          outsideRadius: latest.outsideRadius,
          integrityFlags: latest.integrityFlags,
          recordedAt: latest.recorded_at,
        }
      : null,
    status: derive({
      hasAssignment: Boolean(assignment),
      lastSeenAt: latest?.recorded_at ?? null,
      outsideRadius: latest?.outsideRadius ?? false,
      signalLostAfterSeconds: tracking.signalLostAfterSeconds,
    }),
  };
}

async function setActive(officerId, isActive) {
  const officer = await usersRepo.setActive(officerId, isActive);
  if (!officer) throw AppError.notFound('No such officer');
  return officer;
}

/**
 * Clears the integrity flag and closes the open integrity alert. Integrity
 * alerts never clear themselves - a supervisor has to look at the officer and
 * decide, which is the whole point of raising one.
 */
async function clearIntegrityFlag(officerId, { clearedBy, note }) {
  const officer = await usersRepo.setIntegrityFlag(officerId, false);
  if (!officer) throw AppError.notFound('No such officer');

  await alertsRepo.resolveOpenForUser(officerId, 'integrity', {
    resolvedBy: clearedBy,
    resolution: note || 'Reviewed and cleared by supervisor',
  });

  return officer;
}

module.exports = { listWithStatus, getProfile, setActive, clearIntegrityFlag };
