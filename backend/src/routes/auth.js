const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
}

// Phone is compulsory; email + password are optional/required as noted.
router.post('/register', async (req, res) => {
  const { name, phone, email, password, badgeId, role, adminCode } = req.body;

  if (!name || !phone || !password) {
    return res.status(400).json({ error: 'name, phone and password are required' });
  }
  if (!/^\+?[0-9]{7,15}$/.test(phone)) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }

  let finalRole = 'officer';
  if (role === 'admin') {
    if (!adminCode || adminCode !== process.env.ADMIN_REGISTRATION_CODE) {
      return res.status(403).json({ error: 'Invalid admin registration code' });
    }
    finalRole = 'admin';
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (name, phone, email, password_hash, role, badge_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, phone, email, role`,
      [name, phone, email || null, passwordHash, finalRole, badgeId || null]
    );
    const user = result.rows[0];
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Phone or email already registered' });
    }
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login with phone + password.
router.post('/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ error: 'phone and password are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid phone or password' });
    }
    res.json({
      token: signToken(user),
      user: { id: user.id, name: user.name, phone: user.phone, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
