'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const { config } = require('../config');
const AppError = require('../lib/AppError');
const usersRepo = require('../repositories/users.repo');

const UNIQUE_VIOLATION = '23505';

/** Constant-time comparison, so a wrong registration code leaks nothing by timing. */
function codeMatches(supplied, expected) {
  const a = Buffer.from(String(supplied ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function resolveRole(accessCode) {
  if (codeMatches(accessCode, config.auth.adminRegistrationCode)) return 'admin';
  if (codeMatches(accessCode, config.auth.officerRegistrationCode)) return 'officer';
  throw AppError.forbidden('That access code is not valid. Ask your administrator for the current code.');
}

function issueToken(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role, name: user.name },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtExpiresIn }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.auth.jwtSecret);
  } catch {
    throw AppError.unauthorized('Your session has expired. Please sign in again.');
  }
}

async function register({ name, phone, email, password, badgeId, accessCode }) {
  if (password.length < config.auth.minPasswordLength) {
    throw AppError.badRequest(`Password must be at least ${config.auth.minPasswordLength} characters`);
  }

  const role = resolveRole(accessCode);
  const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);

  try {
    const user = await usersRepo.create({ name, phone, email, passwordHash, role, badgeId });
    return { token: issueToken(user), user };
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      const field = err.constraint?.includes('email') ? 'email address' : 'phone number';
      throw AppError.conflict(`That ${field} is already registered`);
    }
    throw err;
  }
}

async function login({ phone, password }) {
  const user = await usersRepo.findByPhoneWithSecret(phone);

  // Hash against a dummy when the phone is unknown, so both branches cost the
  // same and the response cannot be used to enumerate registered numbers.
  const hash = user?.passwordHash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const passwordOk = await bcrypt.compare(password, hash);

  if (!user || !passwordOk) throw AppError.unauthorized('Invalid phone number or password');
  if (!user.isActive) throw AppError.forbidden('This account has been deactivated by an administrator');

  const { passwordHash: _omit, ...safeUser } = user;
  return { token: issueToken(safeUser), user: safeUser };
}

module.exports = { register, login, issueToken, verifyToken };
