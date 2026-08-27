'use strict';

const rateLimit = require('express-rate-limit');
const { config } = require('../../config');

const message = (text) => ({ error: { code: 'rate_limited', message: text } });

const base = {
  standardHeaders: true,
  legacyHeaders: false,
};

/** Credential endpoints: tight, to blunt password guessing. */
const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: message('Too many attempts. Wait a few minutes and try again.'),
});

/**
 * Position reports: generous enough for a full shift of officers reporting on
 * schedule, tight enough that a runaway client cannot flood the database.
 */
const locationLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  max: Math.ceil((60 / config.tracking.reportIntervalSeconds) * 4),
  keyGenerator: (req) => String(req.user?.id ?? req.ip),
  message: message('Reporting too frequently.'),
});

/** Everything else: a backstop against accidental polling loops. */
const apiLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: (req) => String(req.user?.id ?? req.ip),
  message: message('Too many requests.'),
});

module.exports = { authLimiter, locationLimiter, apiLimiter };
