'use strict';

const AppError = require('../lib/AppError');
const alertsRepo = require('../repositories/alerts.repo');
const usersRepo = require('../repositories/users.repo');

async function listOpen() {
  return alertsRepo.listOpen({ limit: 200 });
}

/**
 * Manually closes an incident. Clearing an integrity alert also lifts the
 * officer's flag, so the two can never drift out of step.
 */
async function resolve({ alertId, resolvedBy, note }) {
  const alert = await alertsRepo.resolveById(alertId, {
    resolvedBy,
    resolution: note || 'Reviewed and closed by supervisor',
  });
  if (!alert) throw AppError.notFound('That alert is not open, or does not exist');

  if (alert.type === 'integrity') {
    await usersRepo.setIntegrityFlag(alert.userId, false);
  }

  return alert;
}

module.exports = { listOpen, resolve };
