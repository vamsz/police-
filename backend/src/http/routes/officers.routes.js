'use strict';

const { Router } = require('express');
const asyncHandler = require('../../lib/asyncHandler');
const { fields, parse, parseId } = require('../../lib/validate');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { config } = require('../../config');

const officersService = require('../../services/officers.service');
const assignmentsService = require('../../services/assignments.service');

const router = Router();

router.use(requireAuth, requireAdmin);

const assignSchema = {
  rallyName: fields.string({ required: true, min: 2, max: 120 }),
  lat: fields.latitude({ required: true }),
  lng: fields.longitude({ required: true }),
  radiusMeters: fields.number({ required: true, min: 10, max: 5000, integer: true }),
  notes: fields.string({ max: 500 }),
};

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await officersService.listWithStatus());
  })
);

/** Declared before '/:id' so Express does not read "meta" as an officer id. */
router.get(
  '/meta/rally-names',
  asyncHandler(async (_req, res) => {
    res.json({
      rallyNames: await assignmentsService.listRallyNames(),
      defaultRadiusMeters: config.tracking.defaultRadiusMeters,
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await officersService.getProfile(parseId(req.params.id, 'officer id')));
  })
);

/** Post an officer to a surveillance point, replacing any post they hold. */
router.put(
  '/:id/assignment',
  asyncHandler(async (req, res) => {
    const body = parse(req.body, assignSchema);
    const assignment = await assignmentsService.assign({
      officerId: parseId(req.params.id, 'officer id'),
      assignedBy: req.user.id,
      ...body,
    });
    res.status(201).json(assignment);
  })
);

router.delete(
  '/:id/assignment',
  asyncHandler(async (req, res) => {
    const ended = await assignmentsService.endAssignment({
      officerId: parseId(req.params.id, 'officer id'),
      endedBy: req.user.id,
    });
    res.json(ended);
  })
);

router.put(
  '/:id/activation',
  asyncHandler(async (req, res) => {
    const { isActive } = parse(req.body, { isActive: fields.boolean({ required: true }) });
    res.json(await officersService.setActive(parseId(req.params.id, 'officer id'), isActive));
  })
);

/** Clears an integrity flag after a supervisor has looked into it. */
router.post(
  '/:id/clear-integrity-flag',
  asyncHandler(async (req, res) => {
    const { note } = parse(req.body, { note: fields.string({ max: 300 }) });
    const officer = await officersService.clearIntegrityFlag(parseId(req.params.id, 'officer id'), {
      clearedBy: req.user.id,
      note,
    });
    res.json(officer);
  })
);

module.exports = router;
