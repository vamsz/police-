const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const result = await pool.query(`
    SELECT al.*, u.name AS user_name, u.phone
    FROM alerts al
    JOIN users u ON u.id = al.user_id
    WHERE al.resolved = false
    ORDER BY al.created_at DESC
    LIMIT 200
  `);
  res.json(result.rows);
});

router.post('/:id/resolve', requireAuth, requireAdmin, async (req, res) => {
  await pool.query('UPDATE alerts SET resolved = true WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
