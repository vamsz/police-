'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const radius = require('../src/domain/radius');

const OPTIONS = { accuracyGraceCapMeters: 35, maxUsableAccuracyMeters: 100 };
const POST = { lat: 12.9716, lng: 77.5946, radiusMeters: 75 };

// ~0.0009 degrees of latitude is roughly 100 m.
const northOf = (metres) => POST.lat + metres / 111_195;

test('no assignment means no breach to judge', () => {
  const result = radius.evaluate({ assignment: null, lat: 0, lng: 0, accuracyMeters: 5 }, OPTIONS);
  assert.equal(result.hasAssignment, false);
  assert.equal(result.outsideRadius, false);
  assert.equal(result.distanceMeters, null);
});

test('an officer standing on the post is on post', () => {
  const result = radius.evaluate({ assignment: POST, lat: POST.lat, lng: POST.lng, accuracyMeters: 8 }, OPTIONS);
  assert.equal(result.outsideRadius, false);
  assert.ok(result.distanceMeters < 1);
});

test('an officer well outside the radius breaches it', () => {
  const result = radius.evaluate({ assignment: POST, lat: northOf(300), lng: POST.lng, accuracyMeters: 10 }, OPTIONS);
  assert.equal(result.outsideRadius, true);
  assert.ok(result.metersOutside > 200);
  assert.equal(result.compass, 'N');
});

test('GPS error is forgiven before calling a breach', () => {
  // 95 m from a 75 m post, but the fix is only accurate to 30 m: the officer may
  // well be standing inside. This is the false alarm that made the old build unusable.
  const result = radius.evaluate({ assignment: POST, lat: northOf(95), lng: POST.lng, accuracyMeters: 30 }, OPTIONS);
  assert.equal(result.outsideRadius, false);
  assert.ok(result.distanceMeters > 90, 'the real distance is still recorded honestly');
});

test('the accuracy grace is capped so a vague fix cannot excuse any distance', () => {
  const result = radius.evaluate({ assignment: POST, lat: northOf(200), lng: POST.lng, accuracyMeters: 90 }, OPTIONS);
  assert.equal(result.outsideRadius, true, 'grace caps at 35 m, so 200 m still breaches a 75 m post');
});

test('a fix too vague to trust never opens a breach', () => {
  const result = radius.evaluate({ assignment: POST, lat: northOf(5000), lng: POST.lng, accuracyMeters: 4000 }, OPTIONS);
  assert.equal(result.accuracyUsable, false);
  assert.equal(result.outsideRadius, false, 'recorded, but not treated as evidence');
});

test('a missing accuracy reading is treated as exact', () => {
  const result = radius.evaluate({ assignment: POST, lat: northOf(200), lng: POST.lng, accuracyMeters: null }, OPTIONS);
  assert.equal(result.outsideRadius, true);
});
