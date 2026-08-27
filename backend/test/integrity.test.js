'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const integrity = require('../src/domain/integrity');
const { REASONS } = integrity;

const OPTIONS = { implausibleSpeedMps: 70, identicalFixThreshold: 5 };
const NOW = new Date('2026-08-26T10:00:00Z');

const fixAt = (overrides = {}) => ({
  lat: 12.9716,
  lng: 77.5946,
  accuracyMeters: 12,
  fixedAt: NOW,
  receivedAt: NOW,
  ...overrides,
});

const storedFix = (overrides = {}) => ({
  lat: 12.9716,
  lng: 77.5946,
  recorded_at: new Date(NOW.getTime() - 10_000),
  ...overrides,
});

test('an ordinary fix raises nothing', () => {
  const result = integrity.evaluate({ fix: fixAt(), previous: null, recentFixes: [], options: OPTIONS, now: NOW });
  assert.deepEqual(result.flags, []);
});

test('a non-positive accuracy is impossible for real hardware', () => {
  const result = integrity.evaluate({ fix: fixAt({ accuracyMeters: 0 }), options: OPTIONS, now: NOW });
  assert.ok(result.flags.includes(REASONS.IMPOSSIBLE_ACCURACY));
});

test('teleporting across the city is flagged', () => {
  // ~19 km in 10 seconds.
  const result = integrity.evaluate({
    fix: fixAt({ lat: 13.1416 }),
    previous: storedFix(),
    options: OPTIONS,
    now: NOW,
  });
  assert.ok(result.flags.includes(REASONS.IMPLAUSIBLE_SPEED));
  assert.ok(result.speedMps > 1000);
});

test('driving at a normal speed is not flagged', () => {
  // ~200 m in 10 s = 20 m/s = 72 km/h.
  const result = integrity.evaluate({
    fix: fixAt({ lat: 12.9716 + 200 / 111_195 }),
    previous: storedFix(),
    options: OPTIONS,
    now: NOW,
  });
  assert.deepEqual(result.flags, []);
  assert.ok(result.speedMps > 15 && result.speedMps < 25);
});

test('speed uses server receipt time, not the device clock', () => {
  // A spoofer claims the fix is an hour old to make a huge jump look slow.
  const result = integrity.evaluate({
    fix: fixAt({ lat: 13.1416, fixedAt: new Date(NOW.getTime() - 3_600_000) }),
    previous: storedFix(),
    options: OPTIONS,
    now: NOW,
  });
  assert.ok(result.flags.includes(REASONS.IMPLAUSIBLE_SPEED), 'the lie about timing does not help');
});

test('a run of byte-identical fixes looks like a pinned mock location', () => {
  const identical = Array.from({ length: 4 }, () => storedFix());
  const result = integrity.evaluate({
    fix: fixAt(),
    previous: identical[0],
    recentFixes: identical,
    options: OPTIONS,
    now: NOW,
  });
  assert.ok(result.flags.includes(REASONS.FROZEN_COORDINATES));
});

test('real GPS jitter breaks the identical run', () => {
  const jittering = [
    storedFix(),
    storedFix({ lat: 12.97160001 }),
    storedFix(),
    storedFix({ lng: 77.59460002 }),
  ];
  const result = integrity.evaluate({
    fix: fixAt(),
    previous: jittering[0],
    recentFixes: jittering,
    options: OPTIONS,
    now: NOW,
  });
  assert.ok(!result.flags.includes(REASONS.FROZEN_COORDINATES));
});

test('a fix timestamped in the future is flagged', () => {
  const result = integrity.evaluate({
    fix: fixAt({ fixedAt: new Date(NOW.getTime() + 30 * 60_000) }),
    options: OPTIONS,
    now: NOW,
  });
  assert.ok(result.flags.includes(REASONS.FUTURE_TIMESTAMP));
});

test('a badly skewed device clock is flagged but distinguished from a future fix', () => {
  const result = integrity.evaluate({
    fix: fixAt({ fixedAt: new Date(NOW.getTime() - 30 * 60_000) }),
    options: OPTIONS,
    now: NOW,
  });
  assert.ok(result.flags.includes(REASONS.CLOCK_SKEW));
  assert.ok(!result.flags.includes(REASONS.FUTURE_TIMESTAMP));
});

test('small clock drift is tolerated', () => {
  const result = integrity.evaluate({
    fix: fixAt({ fixedAt: new Date(NOW.getTime() - 30_000) }),
    options: OPTIONS,
    now: NOW,
  });
  assert.deepEqual(result.flags, []);
});

test('every flag has a human-readable description', () => {
  for (const reason of Object.values(REASONS)) {
    assert.ok(integrity.DESCRIPTIONS[reason], `${reason} needs a description`);
  }
  assert.ok(integrity.describe([REASONS.IMPLAUSIBLE_SPEED]).length > 10);
});
