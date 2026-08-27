'use strict';

const { Router } = require('express');
const asyncHandler = require('../../lib/asyncHandler');
const { fields, parse } = require('../../lib/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { locationLimiter } = require('../middleware/rateLimits');
const trackingService = require('../../services/tracking.service');

const router = Router();

const fixSchema = {
  lat: fields.latitude({ required: true }),
  lng: fields.longitude({ required: true }),
  accuracyMeters: fields.number({ min: -1, max: 100_000 }),
  // The device's own fix time. Kept for the record and sanity-checked against the
  // server clock, but never trusted for speed maths - see domain/integrity.js.
  fixedAt: fields.timestamp(),
};

router.use(requireAuth, requireRole('officer'));

router.post(
  '/fixes',
  locationLimiter,
  asyncHandler(async (req, res) => {
    const body = parse(req.body, fixSchema);
    const standing = await trackingService.recordFix({
      userId: req.user.id,
      lat: body.lat,
      lng: body.lng,
      accuracyMeters: body.accuracyMeters ?? null,
      fixedAt: body.fixedAt ?? new Date(),
    });
    res.status(201).json(standing);
  })
);

router.get(
  '/standing',
  asyncHandler(async (req, res) => {
    res.json(await trackingService.currentStanding(req.user.id));
  })
);

module.exports = router;
