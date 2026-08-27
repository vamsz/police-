'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fields, parse, parseId } = require('../src/lib/validate');
const AppError = require('../src/lib/AppError');

test('undeclared fields are dropped, not passed through', () => {
  const result = parse(
    { name: 'Officer Rao', role: 'admin', isSuperuser: true },
    { name: fields.string({ required: true }) }
  );
  assert.deepEqual(result, { name: 'Officer Rao' });
});

test('numbers arriving as strings are coerced', () => {
  const result = parse({ radiusMeters: '150' }, { radiusMeters: fields.number({ integer: true }) });
  assert.equal(result.radiusMeters, 150);
});

test('every problem is collected, not just the first', () => {
  try {
    parse({ phone: 'nope', lat: 999 }, { phone: fields.phone({ required: true }), lat: fields.latitude({ required: true }) });
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.status, 400);
    assert.equal(err.details.errors.length, 2);
  }
});

test('coordinates outside the real world are rejected', () => {
  assert.throws(() => parse({ lat: 91 }, { lat: fields.latitude({ required: true }) }), AppError);
  assert.throws(() => parse({ lng: -181 }, { lng: fields.longitude({ required: true }) }), AppError);
  assert.doesNotThrow(() => parse({ lat: -89.9 }, { lat: fields.latitude({ required: true }) }));
});

test('NaN and Infinity are not numbers', () => {
  assert.throws(() => parse({ lat: 'abc' }, { lat: fields.latitude({ required: true }) }), AppError);
  assert.throws(() => parse({ lat: Infinity }, { lat: fields.latitude({ required: true }) }), AppError);
});

test('passwords are not trimmed', () => {
  const result = parse({ password: '  spaces me  ' }, { password: fields.string({ trim: false, min: 8 }) });
  assert.equal(result.password, '  spaces me  ');
});

test('phone accepts an optional country prefix only', () => {
  assert.doesNotThrow(() => parse({ phone: '+919876543210' }, { phone: fields.phone({ required: true }) }));
  assert.doesNotThrow(() => parse({ phone: '9876543210' }, { phone: fields.phone({ required: true }) }));
  assert.throws(() => parse({ phone: '98-765-43210' }, { phone: fields.phone({ required: true }) }), AppError);
});

test('a non-object body is handled without crashing', () => {
  assert.throws(() => parse(null, { name: fields.string({ required: true }) }), AppError);
  assert.throws(() => parse('a string', { name: fields.string({ required: true }) }), AppError);
});

test('ids must be positive integers', () => {
  assert.equal(parseId('42'), 42);
  assert.throws(() => parseId('0'), AppError);
  assert.throws(() => parseId('-1'), AppError);
  assert.throws(() => parseId('abc'), AppError);
  assert.throws(() => parseId('1.5'), AppError);
});
