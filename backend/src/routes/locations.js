const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { distanceMeters } = require('../utils/geo');

const router = express.Router();

// Speed no real foot/vehicle patrol should exceed between two fixes (m/s, ~250 km/h).
const IMPLAUSIBLE_SPEED_MPS = 70;

// Officer: push a location update from the browser Geolocation API.
router.post('/', requireAuth, async (req, res) => {
  const { lat, lng, accuracy } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng are required' });

  const userId = req.user.id;
  const flags = [];

  // ponytail: browser JS cannot detect Android mock-location apps or Developer Options —
  // that needs a native app. These are best-effort heuristics only.
  if (accuracy != null && accuracy <= 0) flags.push('mock_location');

  const prev = await pool.query(
    `SELECT lat, lng, recorded_at FROM locations WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
    [userId]
  );
  if (prev.rows[0]) {
    const p = prev.rows[0];
    const seconds = (Date.now() - new Date(p.recorded_at).getTime()) / 1000;
    if (seconds > 0) {
      const speed = distanceMeters(p.lat, p.lng, lat, lng) / seconds;
      if (speed > IMPLAUSIBLE_SPEED_MPS) flags.push('mock_location');
    }
  }

  const isMock = flags.includes('mock_location');
  await pool.query(
    `INSERT INTO locations (user_id, lat, lng, accuracy, is_mock) VALUES ($1, $2, $3, $4, $5)`,
    [userId, lat, lng, accuracy || null, isMock]
  );

  if (isMock) {
    await pool.query(`UPDATE users SET flagged = true WHERE id = $1`, [userId]);
    await pool.query(
      `INSERT INTO alerts (user_id, type, message) VALUES ($1, 'mock_location', 'Suspicious/implausible location update detected')`,
      [userId]
    );
  }

  const assignment = await pool.query(
    `SELECT * FROM assignments WHERE user_id = $1 AND active ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  let outOfRadius = false;
  if (assignment.rows[0]) {
    const a = assignment.rows[0];
    const dist = distanceMeters(a.lat, a.lng, lat, lng);
    outOfRadius = dist > a.radius_meters;
    if (outOfRadius) {
      await pool.query(
        `INSERT INTO alerts (user_id, assignment_id, type, message) VALUES ($1, $2, 'out_of_radius', $3)`,
        [userId, a.id, `Moved ${Math.round(dist)}m from assigned point (limit ${a.radius_meters}m)`]
      );
    }
  }

  res.status(201).json({ ok: true, isMock, outOfRadius });
});

// Admin: latest location per officer, for the live map.
router.get('/live', requireAuth, requireAdmin, async (req, res) => {
  const result = await pool.query(`
    SELECT DISTINCT ON (u.id) u.id AS user_id, u.name, l.lat, l.lng, l.accuracy, l.is_mock, l.recorded_at
    FROM users u
    JOIN locations l ON l.user_id = u.id
    WHERE u.role = 'officer'
    ORDER BY u.id, l.recorded_at DESC
  `);
  res.json(result.rows);
});

module.exports = router;
