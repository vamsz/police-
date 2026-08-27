'use strict';

const AppError = require('./AppError');

/**
 * A deliberately small schema validator.
 *
 * A schema is a plain object mapping field name -> field spec. `parse` returns a
 * new object containing only declared fields, coerced to their declared type, and
 * throws a single 400 listing every problem rather than failing on the first one.
 */

const isBlank = (value) => value === undefined || value === null || value === '';

const fields = {
  string: ({ required = false, min = 1, max = 255, pattern, patternMessage, trim = true } = {}) =>
    (value, name, errors) => {
      if (isBlank(value)) {
        if (required) errors.push(`${name} is required`);
        return undefined;
      }
      if (typeof value !== 'string') {
        errors.push(`${name} must be text`);
        return undefined;
      }
      const text = trim ? value.trim() : value;
      // One message per field: a value that is both too short and malformed
      // should not report the same problem twice.
      if (text.length < min) errors.push(`${name} must be at least ${min} characters`);
      else if (text.length > max) errors.push(`${name} must be at most ${max} characters`);
      else if (pattern && !pattern.test(text)) errors.push(patternMessage || `${name} is not in a valid format`);
      return text;
    },

  number: ({ required = false, min = -Infinity, max = Infinity, integer = false } = {}) =>
    (value, name, errors) => {
      if (isBlank(value)) {
        if (required) errors.push(`${name} is required`);
        return undefined;
      }
      const num = typeof value === 'string' ? Number(value) : value;
      if (typeof num !== 'number' || !Number.isFinite(num)) {
        errors.push(`${name} must be a number`);
        return undefined;
      }
      if (integer && !Number.isInteger(num)) errors.push(`${name} must be a whole number`);
      else if (num < min) errors.push(`${name} must be at least ${min}`);
      else if (num > max) errors.push(`${name} must be at most ${max}`);
      return num;
    },

  boolean: ({ required = false, default: fallback } = {}) =>
    (value, name, errors) => {
      if (isBlank(value)) {
        if (required) errors.push(`${name} is required`);
        return fallback;
      }
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      errors.push(`${name} must be true or false`);
      return undefined;
    },

  enum: (allowed, { required = false } = {}) =>
    (value, name, errors) => {
      if (isBlank(value)) {
        if (required) errors.push(`${name} is required`);
        return undefined;
      }
      if (!allowed.includes(value)) errors.push(`${name} must be one of: ${allowed.join(', ')}`);
      return value;
    },

  timestamp: ({ required = false } = {}) =>
    (value, name, errors) => {
      if (isBlank(value)) {
        if (required) errors.push(`${name} is required`);
        return undefined;
      }
      const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
      if (Number.isNaN(date.getTime())) {
        errors.push(`${name} must be a valid timestamp`);
        return undefined;
      }
      return date;
    },
};

// Domain-specific shorthands, so route schemas stay declarative.
fields.latitude = (opts) => fields.number({ min: -90, max: 90, ...opts });
fields.longitude = (opts) => fields.number({ min: -180, max: 180, ...opts });
fields.phone = (opts) =>
  fields.string({
    min: 7,
    max: 20,
    pattern: /^\+?[0-9]{7,15}$/,
    patternMessage: 'phone must be 7-15 digits, optionally starting with +',
    ...opts,
  });
fields.email = (opts) =>
  fields.string({
    max: 255,
    pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
    patternMessage: 'email is not a valid address',
    ...opts,
  });

function parse(input, schema) {
  const source = input && typeof input === 'object' ? input : {};
  const errors = [];
  const result = {};

  for (const [name, check] of Object.entries(schema)) {
    const value = check(source[name], name, errors);
    if (value !== undefined) result[name] = value;
  }

  if (errors.length) throw AppError.badRequest(errors[0], { errors });
  return result;
}

/** Validates `req.params.id` as a positive integer and returns it. */
function parseId(raw, name = 'id') {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw AppError.badRequest(`${name} must be a positive integer`);
  return id;
}

module.exports = { fields, parse, parseId };
