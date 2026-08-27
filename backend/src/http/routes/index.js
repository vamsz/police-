'use strict';

const { Router } = require('express');
const { config } = require('../../config');
const { requireAuth } = require('../middleware/auth');
const { authLimiter, apiLimiter } = require('../middleware/rateLimits');

const router = Router();

router.use('/auth', authLimiter, require('./auth.routes'));
router.use('/tracking', require('./tracking.routes'));
router.use('/officers', apiLimiter, require('./officers.routes'));
router.use('/assignments', apiLimiter, require('./assignments.routes'));
router.use('/alerts', apiLimiter, require('./alerts.routes'));

/**
 * Client runtime settings. Behind auth: the Maps key is referrer-restricted
 * rather than secret, but there is no reason to hand it to anonymous callers.
 */
router.get('/client-config', requireAuth, (req, res) => {
  res.json({
    googleMapsApiKey: config.maps.apiKey,
    mapsConfigured: Boolean(config.maps.apiKey),
    reportIntervalSeconds: config.tracking.reportIntervalSeconds,
    adminPollSeconds: config.ui.adminPollSeconds,
    defaultRadiusMeters: config.tracking.defaultRadiusMeters,
    signalLostAfterSeconds: config.tracking.signalLostAfterSeconds,
    maxUsableAccuracyMeters: config.tracking.maxUsableAccuracyMeters,
  });
});

module.exports = router;
