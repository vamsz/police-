'use strict';

const { pool } = require('../db/pool');

async function insert(fix, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO location_fixes
       (user_id, assignment_id, lat, lng, accuracy_meters, speed_mps,
        distance_meters, outside_radius, integrity_flags, fixed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, recorded_at AS "recordedAt"`,
    [
      fix.userId,
      fix.assignmentId ?? null,
      fix.lat,
      fix.lng,
      fix.accuracyMeters ?? null,
      fix.speedMps ?? null,
      fix.distanceMeters ?? null,
      fix.outsideRadius,
      fix.integrityFlags,
      fix.fixedAt,
    ]
  );
  return rows[0];
}

/** Newest fixes first. Used for the previous-fix comparison and run detection. */
async function findRecentForUser(userId, limit, db = pool) {
  const { rows } = await db.query(
    `SELECT id, lat, lng, accuracy_meters AS "accuracyMeters", distance_meters AS "distanceMeters",
            outside_radius AS "outsideRadius", integrity_flags AS "integrityFlags",
            fixed_at AS "fixedAt", recorded_at
     FROM location_fixes
     WHERE user_id = $1
     ORDER BY recorded_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

/** Position history for drawing an officer's recent movement on the map. */
async function findTrailForUser(userId, { since, limit = 200 }, db = pool) {
  const { rows } = await db.query(
    `SELECT lat, lng, accuracy_meters AS "accuracyMeters",
            outside_radius AS "outsideRadius", recorded_at AS "recordedAt"
     FROM location_fixes
     WHERE user_id = $1 AND recorded_at >= $2
     ORDER BY recorded_at DESC
     LIMIT $3`,
    [userId, since, limit]
  );
  return rows.reverse(); // chronological, for a polyline
}

async function deleteOlderThan(cutoff, db = pool) {
  const { rowCount } = await db.query('DELETE FROM location_fixes WHERE recorded_at < $1', [cutoff]);
  return rowCount;
}

module.exports = { insert, findRecentForUser, findTrailForUser, deleteOlderThan };
