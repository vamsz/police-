'use strict';

const { pool } = require('../db/pool');

const COLUMNS = `
  id, user_id AS "userId", assignment_id AS "assignmentId", type, severity, status,
  message, details, occurrences, opened_at AS "openedAt", last_seen_at AS "lastSeenAt",
  resolved_at AS "resolvedAt", resolved_by AS "resolvedBy", resolution
`;

/**
 * Opens an incident, or refreshes the one already open for this officer and type.
 *
 * The dedup is enforced by the partial unique index on (user_id, type) WHERE
 * status = 'open', so concurrent fixes cannot race two rows into existence. The
 * `xmax = 0` test distinguishes a genuinely new incident from a repeat, which is
 * what decides whether the console should treat it as news.
 */
async function openOrTouch({ userId, assignmentId, type, severity, message, details }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO alerts (user_id, assignment_id, type, severity, message, details)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, type) WHERE status = 'open'
     DO UPDATE SET
       last_seen_at  = now(),
       occurrences   = alerts.occurrences + 1,
       message       = EXCLUDED.message,
       details       = EXCLUDED.details,
       severity      = EXCLUDED.severity,
       assignment_id = EXCLUDED.assignment_id
     RETURNING ${COLUMNS}, (xmax = 0) AS "isNew"`,
    [userId, assignmentId ?? null, type, severity, message, JSON.stringify(details ?? {})]
  );
  return rows[0];
}

async function resolveOpenForUser(userId, type, { resolvedBy = null, resolution }, db = pool) {
  const { rows } = await db.query(
    `UPDATE alerts
     SET status = 'resolved', resolved_at = now(), resolved_by = $3, resolution = $4
     WHERE user_id = $1 AND type = $2 AND status = 'open'
     RETURNING ${COLUMNS}`,
    [userId, type, resolvedBy, resolution]
  );
  return rows[0] ?? null;
}

async function resolveById(id, { resolvedBy, resolution }, db = pool) {
  const { rows } = await db.query(
    `UPDATE alerts
     SET status = 'resolved', resolved_at = now(), resolved_by = $2, resolution = $3
     WHERE id = $1 AND status = 'open'
     RETURNING ${COLUMNS}`,
    [id, resolvedBy, resolution]
  );
  return rows[0] ?? null;
}

async function listOpen({ limit = 200 } = {}, db = pool) {
  const { rows } = await db.query(
    `SELECT
       a.id, a.user_id AS "userId", a.assignment_id AS "assignmentId", a.type,
       a.severity, a.status, a.message, a.details, a.occurrences,
       a.opened_at AS "openedAt", a.last_seen_at AS "lastSeenAt",
       u.name AS "officerName", u.phone AS "officerPhone"
     FROM alerts a
     JOIN users u ON u.id = a.user_id
     WHERE a.status = 'open'
     ORDER BY (a.severity = 'critical') DESC, a.last_seen_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

async function listForUser(userId, { limit = 50 } = {}, db = pool) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM alerts WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

module.exports = { openOrTouch, resolveOpenForUser, resolveById, listOpen, listForUser };
