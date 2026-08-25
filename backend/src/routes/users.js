const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Admin: list all officers with their latest location + current assignment.
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const result = await pool.query(`
    SELECT
      u.id, u.name, u.phone, u.email, u.badge_id, u.flagged,
      a.id AS assignment_id, a.rally_name, a.lat AS assigned_lat, a.lng AS assigned_lng, a.radius_meters,
      l.lat AS current_lat, l.lng AS current_lng, l.recorded_at AS last_seen
    FROM users u
    LEFT JOIN LATERAL (
      SELECT * FROM assignments WHERE user_id = u.id AND active ORDER BY created_at DESC LIMIT 1
    ) a ON true
    LEFT JOIN LATERAL (
      SELECT lat, lng, recorded_at FROM locations WHERE user_id = u.id ORDER BY recorded_at DESC LIMIT 1
    ) l ON true
    WHERE u.role = 'officer'
    ORDER BY u.name
  `);
  res.json(result.rows);
});

// Admin: full profile for one officer (registered email + phone, per requirement).
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  const result = await pool.query(
    `SELECT id, name, phone, email, badge_id, flagged, created_at FROM users WHERE id = $1 AND role = 'officer'`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(result.rows[0]);
});

module.exports = router;
