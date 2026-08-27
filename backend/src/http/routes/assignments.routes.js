'use strict';

const { Router } = require('express');
const asyncHandler = require('../../lib/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const assignmentsService = require('../../services/assignments.service');

const router = Router();

/** An officer's own post. Admins manage posts through /api/officers/:id/assignment. */
router.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await assignmentsService.findActiveForUser(req.user.id));
  })
);

module.exports = router;
