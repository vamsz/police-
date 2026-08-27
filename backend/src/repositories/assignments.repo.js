'use strict';

const { pool } = require('../db/pool');

const COLUMNS = `
  id, user_id AS "userId", rally_name AS "rallyName", lat, lng,
  radius_meters AS "radiusMeters", notes, status,
  created_by AS "createdBy", created_at AS "createdAt", ended_at AS "endedAt"
`;

async function findActiveForUser(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM assignments WHERE user_id = $1 AND status = 'active'`,
    [userId]
  );
  return rows[0] ?? null;
}

async function endActiveForUser(userId, db = pool) {
  const { rows } = await db.query(
    `UPDATE assignments SET status = 'ended', ended_at = now()
     WHERE user_id = $1 AND status = 'active'
     RETURNING ${COLUMNS}`,
    [userId]
  );
  return rows[0] ?? null;
}

async function create({ userId, rallyName, lat, lng, radiusMeters, notes, createdBy }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO assignments (user_id, rally_name, lat, lng, radius_meters, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [userId, rallyName, lat, lng, radiusMeters, notes ?? null, createdBy]
  );
  return rows[0];
}

/** Distinct rally names seen recently, to populate the console's rally picker. */
async function listRallyNames(db = pool) {
  const { rows } = await db.query(
    `SELECT DISTINCT rally_name AS "rallyName" FROM assignments ORDER BY rally_name`
  );
  return rows.map((r) => r.rallyName);
}

module.exports = { findActiveForUser, endActiveForUser, create, listRallyNames };
