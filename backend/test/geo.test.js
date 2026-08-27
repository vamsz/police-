'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { distanceMeters, bearingDegrees, compassPoint } = require('../src/domain/geo');

test('distance between identical points is zero', () => {
  assert.equal(distanceMeters(12.9716, 77.5946, 12.9716, 77.5946), 0);
});

test('distance matches a known separation', () => {
  // Bengaluru City Railway Station -> Vidhana Soudha, ~2.6 km apart.
  const d = distanceMeters(12.9767, 77.5713, 12.9794, 77.5912);
  assert.ok(d > 2100 && d < 2300, `expected ~2.2 km, got ${Math.round(d)} m`);
});

test('distance is symmetric', () => {
  const a = distanceMeters(12.9, 77.5, 13.1, 77.7);
  const b = distanceMeters(13.1, 77.7, 12.9, 77.5);
  assert.ok(Math.abs(a - b) < 1e-6);
});

test('one degree of latitude is about 111 km anywhere', () => {
  const atEquator = distanceMeters(0, 0, 1, 0);
  const atPole = distanceMeters(60, 30, 61, 30);
  assert.ok(Math.abs(atEquator - 111_195) < 500);
  assert.ok(Math.abs(atPole - 111_195) < 500);
});

test('bearing points the right way', () => {
  assert.ok(Math.abs(bearingDegrees(12.9, 77.5, 13.0, 77.5) - 0) < 0.5, 'due north');
  assert.ok(Math.abs(bearingDegrees(12.9, 77.5, 12.9, 77.6) - 90) < 0.5, 'due east');
  assert.ok(Math.abs(bearingDegrees(12.9, 77.5, 12.8, 77.5) - 180) < 0.5, 'due south');
  assert.ok(Math.abs(bearingDegrees(12.9, 77.5, 12.9, 77.4) - 270) < 0.5, 'due west');
});

test('compass labels wrap correctly', () => {
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(45), 'NE');
  assert.equal(compassPoint(180), 'S');
  assert.equal(compassPoint(359), 'N');
});
