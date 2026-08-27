'use strict';

const { distanceMeters } = require('./geo');

/**
 * Best-effort detection of falsified location reports.
 *
 * Scope, stated plainly: this is a web app, so the position arrives as JSON from
 * a browser we do not control. Nothing here can stop a determined spoofer, and a
 * browser cannot see Android mock-location apps or Developer Options the way a
 * native app could. These checks catch careless faking - the officer who leaves a
 * mock-location app pinned to one coordinate, or who jumps across the city - and
 * nothing more. Treat a flag as a prompt to phone the officer, not as proof.
 */

const REASONS = {
  IMPOSSIBLE_ACCURACY: 'impossible_accuracy',
  IMPLAUSIBLE_SPEED: 'implausible_speed',
  FROZEN_COORDINATES: 'frozen_coordinates',
  FUTURE_TIMESTAMP: 'future_timestamp',
  CLOCK_SKEW: 'clock_skew',
};

const DESCRIPTIONS = {
  [REASONS.IMPOSSIBLE_ACCURACY]: 'Device reported a non-positive GPS accuracy, which real hardware never does',
  [REASONS.IMPLAUSIBLE_SPEED]: 'Position moved faster than any patrol could travel',
  [REASONS.FROZEN_COORDINATES]: 'Consecutive fixes were bit-for-bit identical, unlike real GPS jitter',
  [REASONS.FUTURE_TIMESTAMP]: 'Device reported a fix timestamped in the future',
  [REASONS.CLOCK_SKEW]: 'Device clock is far out of step with the server',
};

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * @param {object} fix              the incoming fix: { lat, lng, accuracyMeters, fixedAt }
 * @param {object|null} previous    the officer's previous stored fix, if any
 * @param {Array} recentFixes       most recent fixes, newest first, for run detection
 * @param {object} options          thresholds from config.tracking
 * @param {Date} now                server clock, injected for testability
 * @returns {{ flags: string[], speedMps: number|null }}
 */
function evaluate({ fix, previous = null, recentFixes = [], options, now = new Date() }) {
  const flags = new Set();
  let speedMps = null;

  if (fix.accuracyMeters != null && fix.accuracyMeters <= 0) {
    flags.add(REASONS.IMPOSSIBLE_ACCURACY);
  }

  const skewMs = fix.fixedAt.getTime() - now.getTime();
  if (skewMs > MAX_CLOCK_SKEW_MS) flags.add(REASONS.FUTURE_TIMESTAMP);
  else if (Math.abs(skewMs) > MAX_CLOCK_SKEW_MS) flags.add(REASONS.CLOCK_SKEW);

  if (previous) {
    // Elapsed time is measured server-side. A spoofer controls the device clock,
    // so trusting it here would let them claim any speed they liked.
    const elapsedSeconds = (fix.receivedAt.getTime() - new Date(previous.recorded_at).getTime()) / 1000;
    if (elapsedSeconds > 0.5) {
      speedMps = distanceMeters(previous.lat, previous.lng, fix.lat, fix.lng) / elapsedSeconds;
      if (speedMps > options.implausibleSpeedMps) flags.add(REASONS.IMPLAUSIBLE_SPEED);
    }
  }

  // Genuine GPS never returns the same double twice in a row; a pinned mock does.
  const run = countLeadingIdenticalFixes(fix, recentFixes);
  if (run >= options.identicalFixThreshold) flags.add(REASONS.FROZEN_COORDINATES);

  return { flags: [...flags], speedMps };
}

function countLeadingIdenticalFixes(fix, recentFixes) {
  let run = 1; // the incoming fix itself
  for (const candidate of recentFixes) {
    if (candidate.lat !== fix.lat || candidate.lng !== fix.lng) break;
    run += 1;
  }
  return run;
}

/** Human-readable summary for an alert message. */
function describe(flags) {
  return flags.map((flag) => DESCRIPTIONS[flag] || flag).join('; ');
}

module.exports = { evaluate, describe, REASONS, DESCRIPTIONS, MAX_CLOCK_SKEW_MS };
