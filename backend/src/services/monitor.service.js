'use strict';

const { config } = require('../config');
const logger = require('../lib/logger');

const usersRepo = require('../repositories/users.repo');
const locationsRepo = require('../repositories/locations.repo');
const alertsRepo = require('../repositories/alerts.repo');

const tracking = config.tracking;

/**
 * A background sweep for the things no request can notice.
 *
 * An officer whose phone dies, loses signal, or closes the browser simply stops
 * sending fixes - there is no request left to raise the alarm on. Only a timer
 * looking for the absence of data can catch that, which is what this does. It
 * also prunes location history past the retention window.
 *
 * The sweep is idempotent: openOrTouch refreshes an existing incident rather than
 * duplicating it, so running it repeatedly (or from two processes) is harmless.
 */

let timer = null;

async function sweepSilentOfficers(now = new Date()) {
  const cutoff = new Date(now.getTime() - tracking.signalLostAfterSeconds * 1000);
  const silent = await usersRepo.listSilentAssignedOfficers(cutoff);

  for (const officer of silent) {
    const silentFor = officer.lastSeenAt
      ? `${Math.round((now - new Date(officer.lastSeenAt)) / 60_000)} min since last position`
      : 'no position ever received';

    await alertsRepo.openOrTouch({
      userId: officer.id,
      assignmentId: officer.assignmentId,
      type: 'signal_lost',
      severity: 'warning',
      message: `Position reporting has stopped (${silentFor})`,
      details: { lastSeenAt: officer.lastSeenAt },
    });
  }

  return silent.length;
}

async function pruneOldFixes(now = new Date()) {
  const cutoff = new Date(now.getTime() - tracking.fixRetentionDays * 86_400_000);
  return locationsRepo.deleteOlderThan(cutoff);
}

async function runOnce() {
  const now = new Date();
  const silent = await sweepSilentOfficers(now);
  const pruned = await pruneOldFixes(now);
  if (silent || pruned) logger.info('Monitor sweep', { silentOfficers: silent, prunedFixes: pruned });
  return { silent, pruned };
}

function start() {
  if (timer) return;
  timer = setInterval(() => {
    runOnce().catch((err) => logger.error('Monitor sweep failed', { error: err.message }));
  }, tracking.monitorIntervalSeconds * 1000);
  timer.unref(); // never keep the process alive just for the sweep
  logger.info('Monitor started', { intervalSeconds: tracking.monitorIntervalSeconds });
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, runOnce, sweepSilentOfficers, pruneOldFixes };
