'use strict';

const AppError = require('../../lib/AppError');
const logger = require('../../lib/logger');
const { config } = require('../../config');

function notFound(req, _res, next) {
  next(new AppError(404, 'not_found', `No route for ${req.method} ${req.originalUrl}`));
}

/**
 * The single place an error becomes a response.
 *
 * Anything that is not an AppError is an unexpected fault: it is logged with its
 * stack and reported as a bare 500, so internal details never reach a client.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error(err.message, { code: err.code });
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }

  logger.error('Unhandled error', {
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.id,
    error: err.message,
    stack: config.isProduction ? undefined : err.stack,
  });

  res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong on our end. Please try again.' },
  });
}

module.exports = { notFound, errorHandler };
