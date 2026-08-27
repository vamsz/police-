'use strict';

require('dotenv').config();

/**
 * Configuration is read once, validated once, and frozen. The process refuses to
 * boot on a missing or unsafe value rather than failing later at request time.
 */

const PLACEHOLDERS = new Set([
  'change-me',
  'change-this-to-a-long-random-string',
  'change-this-secret-code',
  'paste-your-google-maps-js-api-key-here',
]);

const problems = [];

function required(name, { minLength = 1 } = {}) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    problems.push(`${name} is not set`);
    return '';
  }
  if (PLACEHOLDERS.has(value)) {
    problems.push(`${name} still holds the example placeholder value - set a real one`);
    return value;
  }
  if (value.length < minLength) {
    problems.push(`${name} must be at least ${minLength} characters`);
  }
  return value;
}

function optional(name, fallback = '') {
  const value = (process.env[name] || '').trim();
  return value || fallback;
}

function integer(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    problems.push(`${name} must be a whole number between ${min} and ${max}`);
    return fallback;
  }
  return value;
}

function decimal(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    problems.push(`${name} must be a number between ${min} and ${max}`);
    return fallback;
  }
  return value;
}

const env = optional('NODE_ENV', 'development');

const config = Object.freeze({
  env,
  isProduction: env === 'production',
  port: integer('PORT', 4000, { min: 1, max: 65535 }),

  databaseUrl: required('DATABASE_URL'),

  auth: Object.freeze({
    jwtSecret: required('JWT_SECRET', { minLength: 32 }),
    jwtExpiresIn: optional('JWT_EXPIRES_IN', '12h'),
    bcryptRounds: integer('BCRYPT_ROUNDS', 12, { min: 10, max: 15 }),
    // Registration is gated by shared codes so the deployment is not open to the public.
    adminRegistrationCode: required('ADMIN_REGISTRATION_CODE', { minLength: 8 }),
    officerRegistrationCode: required('OFFICER_REGISTRATION_CODE', { minLength: 8 }),
    minPasswordLength: integer('MIN_PASSWORD_LENGTH', 8, { min: 8, max: 128 }),
  }),

  maps: Object.freeze({
    apiKey: optional('GOOGLE_MAPS_API_KEY'),
    // The view shown before any officer position is known, and the empty-state
    // fallback. Defaults to central Bengaluru; set these to your own city.
    defaultLat: decimal('MAP_DEFAULT_LAT', 12.9716, { min: -90, max: 90 }),
    defaultLng: decimal('MAP_DEFAULT_LNG', 77.5946, { min: -180, max: 180 }),
    defaultZoom: integer('MAP_DEFAULT_ZOOM', 12, { min: 3, max: 20 }),
    // Stops the map zooming out to a country/world view of mostly-empty tiles,
    // which is pointless for a single-city deployment and slow to load.
    minZoom: integer('MAP_MIN_ZOOM', 11, { min: 3, max: 18 }),
    maxZoom: integer('MAP_MAX_ZOOM', 20, { min: 14, max: 22 }),
  }),

  tracking: Object.freeze({
    // Officers report at most this often; the client throttles to match.
    reportIntervalSeconds: integer('REPORT_INTERVAL_SECONDS', 10, { min: 3, max: 300 }),
    // A fix worse than this is too vague to judge a breach against a small radius.
    maxUsableAccuracyMeters: integer('MAX_USABLE_ACCURACY_METERS', 100, { min: 10, max: 1000 }),
    // How much GPS error to forgive before calling a breach. Keeps a stationary
    // officer from alerting simply because the fix wandered.
    accuracyGraceCapMeters: integer('ACCURACY_GRACE_CAP_METERS', 35, { min: 0, max: 200 }),
    // Faster than any plausible patrol movement between two fixes (~250 km/h).
    implausibleSpeedMps: integer('IMPLAUSIBLE_SPEED_MPS', 70, { min: 20, max: 500 }),
    // Real GPS jitters; a run of byte-identical fixes suggests an injected position.
    identicalFixThreshold: integer('IDENTICAL_FIX_THRESHOLD', 5, { min: 3, max: 50 }),
    defaultRadiusMeters: integer('DEFAULT_RADIUS_METERS', 75, { min: 10, max: 5000 }),
    // An assigned officer silent for this long raises a signal_lost alert.
    signalLostAfterSeconds: integer('SIGNAL_LOST_AFTER_SECONDS', 180, { min: 60, max: 3600 }),
    monitorIntervalSeconds: integer('MONITOR_INTERVAL_SECONDS', 30, { min: 10, max: 600 }),
    // Location history older than this is pruned by the monitor sweep.
    fixRetentionDays: integer('FIX_RETENTION_DAYS', 30, { min: 1, max: 365 }),
  }),

  ui: Object.freeze({
    adminPollSeconds: integer('ADMIN_POLL_SECONDS', 5, { min: 2, max: 60 }),
  }),
});

function assertValid() {
  if (problems.length) {
    const list = problems.map((p) => `  - ${p}`).join('\n');
    throw new Error(`Invalid configuration:\n${list}\n\nCopy backend/.env.example to backend/.env and fill it in.`);
  }
  return config;
}

module.exports = { config, assertValid };
