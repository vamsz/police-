'use strict';

const AppError = require('../lib/AppError');
const { withTransaction } = require('../db/pool');
const logger = require('../lib/logger');

const usersRepo = require('../repositories/users.repo');
const assignmentsRepo = require('../repositories/assignments.repo');
const alertsRepo = require('../repositories/alerts.repo');

/**
 * Posts an officer to a surveillance point, replacing any post they already hold.
 *
 * Ending the old post and opening the new one happen together, so the partial
 * unique index guaranteeing one active post per officer is never violated. Alerts
 * tied to the old post are closed: a breach of a post that no longer exists is
 * not something a supervisor should still be looking at.
 */
async function assign({ officerId, rallyName, lat, lng, radiusMeters, notes, assignedBy }) {
  return withTransaction(async (client) => {
    const officer = await usersRepo.findOfficerById(officerId, client);
    if (!officer) throw AppError.notFound('No such officer');
    if (!officer.isActive) throw AppError.conflict('That officer account is deactivated');

    const previous = await assignmentsRepo.endActiveForUser(officerId, client);

    if (previous) {
      await alertsRepo.resolveOpenForUser(
        officerId,
        'out_of_radius',
        { resolvedBy: assignedBy, resolution: 'Officer reassigned to a new post' },
        client
      );
    }
    await alertsRepo.resolveOpenForUser(
      officerId,
      'signal_lost',
      { resolvedBy: assignedBy, resolution: 'Officer reassigned to a new post' },
      client
    );

    const assignment = await assignmentsRepo.create(
      { userId: officerId, rallyName, lat, lng, radiusMeters, notes, createdBy: assignedBy },
      client
    );

    logger.info('Assignment created', { officerId, assignmentId: assignment.id, rallyName });
    return assignment;
  });
}

/** Stands an officer down. Their open post-related alerts close with them. */
async function endAssignment({ officerId, endedBy }) {
  return withTransaction(async (client) => {
    const ended = await assignmentsRepo.endActiveForUser(officerId, client);
    if (!ended) throw AppError.notFound('That officer has no active assignment');

    for (const type of ['out_of_radius', 'signal_lost']) {
      await alertsRepo.resolveOpenForUser(
        officerId,
        type,
        { resolvedBy: endedBy, resolution: 'Assignment ended' },
        client
      );
    }

    logger.info('Assignment ended', { officerId, assignmentId: ended.id });
    return ended;
  });
}

async function findActiveForUser(userId) {
  return assignmentsRepo.findActiveForUser(userId);
}

async function listRallyNames() {
  return assignmentsRepo.listRallyNames();
}

module.exports = { assign, endAssignment, findActiveForUser, listRallyNames };
