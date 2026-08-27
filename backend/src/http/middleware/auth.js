'use strict';

const AppError = require('../../lib/AppError');
const asyncHandler = require('../../lib/asyncHandler');
const authService = require('../../services/auth.service');
const usersRepo = require('../../repositories/users.repo');

/**
 * Verifies the bearer token and reloads the user from the database on every
 * request. That extra read is what makes deactivation take effect immediately:
 * a JWT alone would keep working until it expired, which is not acceptable when
 * the account being switched off may belong to a compromised officer.
 */
const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ')) throw AppError.unauthorized('Missing bearer token');

  const claims = authService.verifyToken(header.slice(7).trim());
  const user = await usersRepo.findById(Number(claims.sub));

  if (!user) throw AppError.unauthorized('Account no longer exists');
  if (!user.isActive) throw AppError.forbidden('This account has been deactivated');

  req.user = user;
  next();
});

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!roles.includes(req.user.role)) return next(AppError.forbidden());
    next();
  };
}

const requireAdmin = requireRole('admin');

module.exports = { requireAuth, requireRole, requireAdmin };
