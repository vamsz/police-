'use strict';

const logger = require('../../lib/logger');

// High-frequency, low-value events that would drown a security audit log. Officer
// position pings are recorded in the database already; they don't belong here.
const SKIP_PATHS = new Set(['/api/tracking/fixes']);
const AUDITED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Emits one structured audit record per security-relevant, state-changing
 * request: who did what, from where, and whether it succeeded. Written after the
 * response so the real status code is known. This is the tamper-evident trail an
 * enterprise deployment needs for "who reassigned that officer / cleared that
 * flag / signed in from where".
 */
function auditLog(req, res, next) {
  if (!AUDITED_METHODS.has(req.method) || SKIP_PATHS.has(req.path)) return next();

  res.on('finish', () => {
    logger.info('audit', {
      category: 'audit',
      action: `${req.method} ${req.originalUrl.split('?')[0]}`,
      status: res.statusCode,
      outcome: res.statusCode < 400 ? 'success' : 'denied',
      actorId: req.user?.id ?? null,
      actorRole: req.user?.role ?? null,
      ip: req.ip,
      userAgent: req.get('user-agent') || null,
    });
  });

  next();
}

module.exports = { auditLog };
