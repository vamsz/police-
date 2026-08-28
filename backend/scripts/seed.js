'use strict';

/**
 * Loads a small, realistic deployment for demos and manual testing.
 *
 * Safe to re-run: it clears the officer roster it created and rebuilds it. It
 * refuses to run against NODE_ENV=production, because "safe to re-run" and
 * "deletes every officer" are the same sentence.
 */

const bcrypt = require('bcryptjs');
const { assertValid, config } = require('../src/config');

const RALLY = 'MG Road Rally';

// Posts spread along MG Road, Bengaluru.
const POSTS = [
  { name: 'Junction — north barricade', lat: 12.9754, lng: 77.6068, radiusMeters: 80 },
  { name: 'Metro entrance', lat: 12.9748, lng: 77.6094, radiusMeters: 60 },
  { name: 'Parade ground gate', lat: 12.9739, lng: 77.6121, radiusMeters: 100 },
  { name: 'South barricade', lat: 12.9722, lng: 77.6148, radiusMeters: 75 },
];

const OFFICERS = [
  { name: 'A. Ramesh', phone: '+919000000101', badgeId: 'KA-1041', post: 0, offsetMeters: 15 },
  { name: 'B. Sunitha', phone: '+919000000102', badgeId: 'KA-1042', post: 1, offsetMeters: 8 },
  { name: 'C. Manjunath', phone: '+919000000103', badgeId: 'KA-1043', post: 2, offsetMeters: 260 },
  { name: 'D. Fathima', phone: '+919000000104', badgeId: 'KA-1044', post: 3, offsetMeters: null },
  { name: 'E. Prakash', phone: '+919000000105', badgeId: 'KA-1045', post: null, offsetMeters: null },
];

const DEMO_PASSWORD = 'officer123';
const ADMIN = { name: 'Supervisor Rao', phone: '+919000000100', badgeId: 'KA-0001', password: 'admin1234' };

const metresNorth = (lat, metres) => lat + metres / 111_195;

async function seed() {
  assertValid();

  if (config.isProduction) {
    throw new Error('Refusing to seed a production database.');
  }

  const { pool, withTransaction } = require('../src/db/pool');

  await withTransaction(async (client) => {
    // Delete officers before the admin. Officer rows cascade to the assignments
    // they own, which is what carries created_by = admin.id; clearing them first
    // leaves the admin unreferenced and safe to remove. Deleting both at once
    // trips assignments_created_by_fkey, which intentionally has no cascade.
    await client.query('DELETE FROM users WHERE phone = ANY($1)', [OFFICERS.map((o) => o.phone)]);
    await client.query('DELETE FROM users WHERE phone = $1', [ADMIN.phone]);

    const adminHash = await bcrypt.hash(ADMIN.password, config.auth.bcryptRounds);
    const { rows: [admin] } = await client.query(
      `INSERT INTO users (name, phone, password_hash, role, badge_id)
       VALUES ($1, $2, $3, 'admin', $4) RETURNING id`,
      [ADMIN.name, ADMIN.phone, adminHash, ADMIN.badgeId]
    );

    const officerHash = await bcrypt.hash(DEMO_PASSWORD, config.auth.bcryptRounds);

    for (const spec of OFFICERS) {
      const { rows: [officer] } = await client.query(
        `INSERT INTO users (name, phone, email, password_hash, role, badge_id)
         VALUES ($1, $2, $3, $4, 'officer', $5) RETURNING id`,
        [
          spec.name,
          spec.phone,
          `${spec.name.split(' ').pop().toLowerCase()}@example.gov.in`,
          officerHash,
          spec.badgeId,
        ]
      );

      if (spec.post === null) continue;

      const post = POSTS[spec.post];
      const { rows: [assignment] } = await client.query(
        `INSERT INTO assignments (user_id, rally_name, lat, lng, radius_meters, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [officer.id, RALLY, post.lat, post.lng, post.radiusMeters, post.name, admin.id]
      );

      // An officer with no offset has been posted but has never reported in,
      // which is exactly the case the signal-lost sweep is there to catch.
      if (spec.offsetMeters === null) continue;

      const lat = metresNorth(post.lat, spec.offsetMeters);
      const outside = spec.offsetMeters > post.radiusMeters;

      await client.query(
        `INSERT INTO location_fixes
           (user_id, assignment_id, lat, lng, accuracy_meters, distance_meters, outside_radius, fixed_at)
         VALUES ($1, $2, $3, $4, 12, $5, $6, now())`,
        [officer.id, assignment.id, lat, post.lng, spec.offsetMeters, outside]
      );

      if (outside) {
        await client.query(
          `INSERT INTO alerts (user_id, assignment_id, type, severity, message, details)
           VALUES ($1, $2, 'out_of_radius', 'warning', $3, $4)`,
          [
            officer.id,
            assignment.id,
            `${spec.offsetMeters} m from assigned post (limit ${post.radiusMeters} m), heading N`,
            JSON.stringify({ distanceMeters: spec.offsetMeters, radiusMeters: post.radiusMeters }),
          ]
        );
      }
    }
  });

  await pool.end();

  console.log(`
Seeded "${RALLY}" with ${OFFICERS.length} officers.

  Supervisor   ${ADMIN.phone}   password: ${ADMIN.password}
  Officers     ${OFFICERS[0].phone} … ${OFFICERS.at(-1).phone}   password: ${DEMO_PASSWORD}

Sign in as the supervisor to see the console. One officer is outside their
radius, one has never reported, and one has no post at all.
`);
}

seed().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
