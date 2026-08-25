const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Admin assigns/reassigns a surveillance location to an officer for a rally.
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { userId, rallyName, lat, lng, radiusMeters } = req.body;
  if (!userId || !rallyName || lat == null || lng == null) {
    return res.status(400).json({ error: 'userId, rallyName, lat, lng are required' });
  }

  await pool.query('UPDATE assignments SET active = false WHERE user_id = $1 AND active', [userId]);
  const result = await pool.query(
    `INSERT INTO assignments (user_id, rally_name, lat, lng, radius_meters, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [userId, rallyName, lat, lng, radiusMeters || 25, req.user.id]
  );
  res.status(201).json(result.rows[0]);
});

// Officer: get my current active assignment.
router.get('/mine', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM assignments WHERE user_id = $1 AND active ORDER BY created_at DESC LIMIT 1`,
    [req.user.id]
  );
  res.json(result.rows[0] || null);
});

module.exports = router;
