'use strict';

const { Router } = require('express');
const asyncHandler = require('../../lib/asyncHandler');
const { fields, parse } = require('../../lib/validate');
const { requireAuth } = require('../middleware/auth');
const authService = require('../../services/auth.service');

const router = Router();

const registerSchema = {
  name: fields.string({ required: true, min: 2, max: 120 }),
  phone: fields.phone({ required: true }),
  email: fields.email(),
  password: fields.string({ required: true, min: 8, max: 200, trim: false }),
  badgeId: fields.string({ max: 40 }),
  accessCode: fields.string({ required: true, max: 200, trim: false }),
};

const loginSchema = {
  phone: fields.phone({ required: true }),
  password: fields.string({ required: true, max: 200, trim: false }),
};

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const result = await authService.register(parse(req.body, registerSchema));
    res.status(201).json(result);
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const result = await authService.login(parse(req.body, loginSchema));
    res.json(result);
  })
);

/** Lets a client confirm its stored token is still good before trusting the UI. */
router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

module.exports = router;
