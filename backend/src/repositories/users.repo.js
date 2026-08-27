'use strict';

const { pool } = require('../db/pool');

const PUBLIC_COLUMNS = `
  id, name, phone, email, badge_id AS "badgeId", role,
  is_active AS "isActive", integrity_flagged AS "integrityFlagged",
  created_at AS "createdAt"
`;

async function create({ name, phone, email, passwordHash, role, badgeId }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO users (name, phone, email, password_hash, role, badge_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${PUBLIC_COLUMNS}`,
    [name, phone, email ?? null, passwordHash, role, badgeId ?? null]
  );
  return rows[0];
}

/** Includes the password hash - only for the login path. */
async function findByPhoneWithSecret(phone, db = pool) {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_COLUMNS}, password_hash AS "passwordHash" FROM users WHERE phone = $1`,
    [phone]
  );
  return rows[0] ?? null;
}

async function findById(id, db = pool) {
  const { rows } = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

async function findOfficerById(id, db = pool) {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1 AND role = 'officer'`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * One row per officer carrying everything the console needs: current post,
 * newest fix, and which alert types are open. Three lateral joins keep it to a
 * single round trip no matter how many officers are on duty.
 */
async function listOfficersWithStatus(db = pool) {
  const { rows } = await db.query(`
    SELECT
      u.id, u.name, u.phone, u.email, u.badge_id AS "badgeId",
      u.is_active AS "isActive", u.integrity_flagged AS "integrityFlagged",
      a.id AS "assignmentId", a.rally_name AS "rallyName",
      a.lat AS "postLat", a.lng AS "postLng", a.radius_meters AS "radiusMeters",
      a.notes AS "assignmentNotes", a.created_at AS "assignedAt",
      f.lat AS "currentLat", f.lng AS "currentLng",
      f.accuracy_meters AS "accuracyMeters", f.distance_meters AS "distanceMeters",
      f.outside_radius AS "outsideRadius", f.integrity_flags AS "integrityFlags",
      f.recorded_at AS "lastSeenAt",
      COALESCE(al.types, ARRAY[]::TEXT[]) AS "openAlertTypes"
    FROM users u
    LEFT JOIN LATERAL (
      SELECT id, rally_name, lat, lng, radius_meters, notes, created_at
      FROM assignments WHERE user_id = u.id AND status = 'active' LIMIT 1
    ) a ON TRUE
    LEFT JOIN LATERAL (
      SELECT lat, lng, accuracy_meters, distance_meters, outside_radius, integrity_flags, recorded_at
      FROM location_fixes WHERE user_id = u.id ORDER BY recorded_at DESC LIMIT 1
    ) f ON TRUE
    LEFT JOIN LATERAL (
      SELECT array_agg(DISTINCT type) AS types
      FROM alerts WHERE user_id = u.id AND status = 'open'
    ) al ON TRUE
    WHERE u.role = 'officer'
    ORDER BY u.name
  `);
  return rows;
}

/** Officers holding an active post whose newest fix is older than the cutoff (or absent). */
async function listSilentAssignedOfficers(cutoff, db = pool) {
  const { rows } = await db.query(
    `SELECT u.id, u.name, a.id AS "assignmentId", f.recorded_at AS "lastSeenAt"
     FROM users u
     JOIN assignments a ON a.user_id = u.id AND a.status = 'active'
     LEFT JOIN LATERAL (
       SELECT recorded_at FROM location_fixes WHERE user_id = u.id ORDER BY recorded_at DESC LIMIT 1
     ) f ON TRUE
     WHERE u.is_active
       AND (f.recorded_at IS NULL OR f.recorded_at < $1)
       AND a.created_at < $1`,
    [cutoff]
  );
  return rows;
}

async function setIntegrityFlag(id, flagged, db = pool) {
  const { rows } = await db.query(
    `UPDATE users SET integrity_flagged = $2, updated_at = now()
     WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
    [id, flagged]
  );
  return rows[0] ?? null;
}

async function setActive(id, isActive, db = pool) {
  const { rows } = await db.query(
    `UPDATE users SET is_active = $2, updated_at = now()
     WHERE id = $1 AND role = 'officer' RETURNING ${PUBLIC_COLUMNS}`,
    [id, isActive]
  );
  return rows[0] ?? null;
}

module.exports = {
  create,
  findByPhoneWithSecret,
  findById,
  findOfficerById,
  listOfficersWithStatus,
  listSilentAssignedOfficers,
  setIntegrityFlag,
  setActive,
};
