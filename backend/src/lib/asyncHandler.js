'use strict';

/**
 * Express 4 does not catch rejected promises from async handlers: an unhandled
 * rejection leaves the request hanging forever. Wrapping every async route in
 * this forwards rejections to the central error handler instead.
 */
module.exports = function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
};
