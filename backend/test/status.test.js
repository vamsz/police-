'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { STATUS, derive } = require('../src/domain/status');

const NOW = new Date('2026-08-26T10:00:00Z');
const secondsAgo = (s) => new Date(NOW.getTime() - s * 1000);
const base = { signalLostAfterSeconds: 180, now: NOW };

test('an officer with no post is unassigned', () => {
  assert.equal(derive({ ...base, hasAssignment: false, lastSeenAt: secondsAgo(5) }), STATUS.UNASSIGNED);
});

test('an assigned officer who has never reported has no signal', () => {
  assert.equal(derive({ ...base, hasAssignment: true, lastSeenAt: null }), STATUS.NO_SIGNAL);
});

test('a recent fix inside the radius is on post', () => {
  assert.equal(
    derive({ ...base, hasAssignment: true, lastSeenAt: secondsAgo(20), outsideRadius: false }),
    STATUS.ON_POST
  );
});

test('a recent fix outside the radius is a breach', () => {
  assert.equal(
    derive({ ...base, hasAssignment: true, lastSeenAt: secondsAgo(20), outsideRadius: true }),
    STATUS.OUTSIDE
  );
});

test('silence outranks a stale verdict about position', () => {
  // Once reporting stops the last known position is a guess; saying so is more
  // useful to an operator than repeating an out-of-date "outside".
  assert.equal(
    derive({ ...base, hasAssignment: true, lastSeenAt: secondsAgo(600), outsideRadius: true }),
    STATUS.STALE
  );
});

test('a fix too vague to judge is reported as such, not as on post', () => {
  assert.equal(
    derive({ ...base, hasAssignment: true, lastSeenAt: secondsAgo(20), accuracyUsable: false }),
    STATUS.LOW_ACCURACY
  );
});

test('the staleness boundary is respected', () => {
  assert.equal(derive({ ...base, hasAssignment: true, lastSeenAt: secondsAgo(179) }), STATUS.ON_POST);
  assert.equal(derive({ ...base, hasAssignment: true, lastSeenAt: secondsAgo(181) }), STATUS.STALE);
});
