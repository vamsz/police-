'use strict';

const { Router } = require('express');
const asyncHandler = require('../../lib/asyncHandler');
const { fields, parse, parseId } = require('../../lib/validate');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const alertsService = require('../../services/alerts.service');

const router = Router();

router.use(requireAuth, requireAdmin);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ alerts: await alertsService.listOpen() });
  })
);

router.post(
  '/:id/resolve',
  asyncHandler(async (req, res) => {
    const { note } = parse(req.body, { note: fields.string({ max: 300 }) });
    const alert = await alertsService.resolve({
      alertId: parseId(req.params.id, 'alert id'),
      resolvedBy: req.user.id,
      note,
    });
    res.json(alert);
  })
);

module.exports = router;
