'use strict';

/**
 * An error that is safe to surface to API clients.
 *
 * Anything thrown that is *not* an AppError is treated by the error handler as
 * an unexpected fault: it gets logged in full and reported as a generic 500, so
 * internal details never leak to the client.
 */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }

  static badRequest(message, details) {
    return new AppError(400, 'bad_request', message, details);
  }

  static unauthorized(message = 'Authentication required') {
    return new AppError(401, 'unauthorized', message);
  }

  static forbidden(message = 'You do not have access to this resource') {
    return new AppError(403, 'forbidden', message);
  }

  static notFound(message = 'Not found') {
    return new AppError(404, 'not_found', message);
  }

  static conflict(message, details) {
    return new AppError(409, 'conflict', message, details);
  }
}

module.exports = AppError;
