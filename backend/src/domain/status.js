'use strict';

/**
 * The single definition of "how is this officer doing right now".
 *
 * Both the officer's own screen and the admin console derive their status from
 * this function, so the two can never disagree about whether someone is on post.
 */

const STATUS = Object.freeze({
  UNASSIGNED: 'unassigned',
  NO_SIGNAL: 'no_signal',
  STALE: 'stale',
  OUTSIDE: 'outside',
  LOW_ACCURACY: 'low_accuracy',
  ON_POST: 'on_post',
});

/**
 * Evaluated in order of what an operator most needs to know. "Stale" outranks
 * "outside" deliberately: once reporting stops, the last known position is a
 * guess, and saying so is more useful than repeating a stale verdict. The open
 * out_of_radius alert stays visible regardless.
 */
function derive({
  hasAssignment,
  lastSeenAt,
  outsideRadius = false,
  accuracyUsable = true,
  signalLostAfterSeconds,
  now = new Date(),
}) {
  if (!hasAssignment) return STATUS.UNASSIGNED;
  if (!lastSeenAt) return STATUS.NO_SIGNAL;

  const ageSeconds = (now.getTime() - new Date(lastSeenAt).getTime()) / 1000;
  if (ageSeconds > signalLostAfterSeconds) return STATUS.STALE;

  if (outsideRadius) return STATUS.OUTSIDE;
  if (!accuracyUsable) return STATUS.LOW_ACCURACY;
  return STATUS.ON_POST;
}

module.exports = { STATUS, derive };
