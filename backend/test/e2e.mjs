// End-to-end lifecycle test against the live server + database.
//
// Exercises the full officer journey the way the browser would: registration
// (role-gated by code), assignment, position reporting, breach detection with
// auto-resolve, spoof-flagging, supervisor clearing, and immediate deactivation.
// Self-contained: it registers its own throwaway officer and deletes it at the end.
//
//   node test/e2e.mjs
//
// Requires the server running on :4000 and the .env registration codes.

import 'dotenv/config';
import { Client } from 'pg';

const BASE = process.env.E2E_BASE || 'http://localhost:4000';
const ADMIN = { phone: '+919000000100', password: 'admin1234' };
const OFFICER_CODE = process.env.OFFICER_REGISTRATION_CODE;

// A post near MG Road, Bengaluru, 60 m radius, for the test officer.
const POST = { rallyName: 'E2E Test Rally', lat: 12.9748, lng: 77.6094, radiusMeters: 60, notes: 'E2E post' };
const metresNorth = (lat, m) => lat + m / 111_195;

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => null);
  return { status: res.status, body: payload };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const uniquePhone = () => '+9198' + String(Date.now()).slice(-8);

async function run() {
  console.log(`\nEnd-to-end test against ${BASE}\n`);
  const officerPhone = uniquePhone();
  const officerPassword = 'e2e-password-123';

  // 1. Health
  const health = await call('/health');
  check('server is healthy', health.status === 200 && health.body?.status === 'ok');

  // 2. Registration is code-gated
  const noCode = await call('/api/auth/register', {
    method: 'POST',
    body: { name: 'E2E Officer', phone: officerPhone, password: officerPassword, accessCode: 'wrong-code' },
  });
  check('registration rejects a bad access code', noCode.status === 403, `got ${noCode.status}`);

  const reg = await call('/api/auth/register', {
    method: 'POST',
    body: { name: 'E2E Officer', phone: officerPhone, password: officerPassword, accessCode: OFFICER_CODE, badgeId: 'E2E-1' },
  });
  check('officer registers with the officer code', reg.status === 201 && reg.body?.user?.role === 'officer', `got ${reg.status}`);
  const officerId = reg.body?.user?.id;
  let officerToken = reg.body?.token;

  // 3. Admin login
  const adminLogin = await call('/api/auth/login', { method: 'POST', body: ADMIN });
  check('supervisor signs in', adminLogin.status === 200 && adminLogin.body?.user?.role === 'admin');
  const adminToken = adminLogin.body?.token;

  // 4. Role guard: officer cannot read the roster
  const guard = await call('/api/officers', { token: officerToken });
  check('officer is denied the admin roster', guard.status === 403, `got ${guard.status}`);

  // 5. Officer starts unassigned
  let standing = await call('/api/tracking/standing', { token: officerToken });
  check('new officer is unassigned', standing.body?.status === 'unassigned', standing.body?.status);

  // 6. Admin assigns a post
  const assign = await call(`/api/officers/${officerId}/assignment`, { method: 'PUT', token: adminToken, body: POST });
  check('admin assigns a post', assign.status === 201 && assign.body?.radiusMeters === 60, `got ${assign.status}`);

  // 7. Officer reports on post
  let fix = await call('/api/tracking/fixes', {
    method: 'POST', token: officerToken,
    body: { lat: POST.lat, lng: POST.lng, accuracyMeters: 8 },
  });
  check('fix on the post reads on_post', fix.body?.status === 'on_post', fix.body?.status);
  check('distance on the post is ~0 m', fix.body?.distanceMeters < 5, `${fix.body?.distanceMeters} m`);

  // 8. Officer moves outside -> breach + alert
  await wait(1100); // clear the identical-fix / sub-0.5s speed window
  fix = await call('/api/tracking/fixes', {
    method: 'POST', token: officerToken,
    body: { lat: metresNorth(POST.lat, 300), lng: POST.lng, accuracyMeters: 8 },
  });
  check('fix 300 m away reads outside', fix.body?.status === 'outside', fix.body?.status);
  check('breach reports a northward bearing', fix.body?.compass === 'N', fix.body?.compass);

  let alerts = await call('/api/alerts', { token: adminToken });
  const breach = alerts.body?.alerts?.find((a) => a.userId === officerId && a.type === 'out_of_radius');
  check('an out_of_radius alert opened for the officer', Boolean(breach));

  // 9. Repeat breach de-dups (occurrences bump, no second row)
  await wait(1100);
  await call('/api/tracking/fixes', {
    method: 'POST', token: officerToken,
    body: { lat: metresNorth(POST.lat, 320), lng: POST.lng, accuracyMeters: 8 },
  });
  alerts = await call('/api/alerts', { token: adminToken });
  const breaches = alerts.body?.alerts?.filter((a) => a.userId === officerId && a.type === 'out_of_radius') ?? [];
  check('repeat breach does not duplicate the alert', breaches.length === 1, `${breaches.length} open`);
  check('repeat breach bumps the occurrence count', (breaches[0]?.occurrences ?? 0) >= 2, `occ=${breaches[0]?.occurrences}`);

  // 10. Officer returns -> alert auto-resolves
  await wait(1100);
  fix = await call('/api/tracking/fixes', {
    method: 'POST', token: officerToken,
    body: { lat: POST.lat, lng: POST.lng, accuracyMeters: 8 },
  });
  check('returning to the post reads on_post again', fix.body?.status === 'on_post', fix.body?.status);
  alerts = await call('/api/alerts', { token: adminToken });
  const stillOpen = alerts.body?.alerts?.some((a) => a.userId === officerId && a.type === 'out_of_radius');
  check('out_of_radius alert auto-resolves on return', !stillOpen);

  // 11. Spoof detection: teleport across the city
  await wait(1100);
  fix = await call('/api/tracking/fixes', {
    method: 'POST', token: officerToken,
    body: { lat: metresNorth(POST.lat, 18_000), lng: POST.lng, accuracyMeters: 8 },
  });
  check('a teleport is flagged for integrity', fix.body?.integrityFlags?.includes('implausible_speed'), JSON.stringify(fix.body?.integrityFlags));

  let roster = await call('/api/officers', { token: adminToken });
  let me = roster.body?.officers?.find((o) => o.id === officerId);
  check('officer shows as integrity-flagged in the roster', me?.integrityFlagged === true);

  alerts = await call('/api/alerts', { token: adminToken });
  const integrity = alerts.body?.alerts?.find((a) => a.userId === officerId && a.type === 'integrity');
  check('a critical integrity alert opened', integrity?.severity === 'critical', integrity?.severity);

  // 12. Supervisor clears the flag
  const clear = await call(`/api/officers/${officerId}/clear-integrity-flag`, {
    method: 'POST', token: adminToken, body: { note: 'Confirmed by radio (E2E)' },
  });
  check('supervisor clears the integrity flag', clear.status === 200 && clear.body?.integrityFlagged === false);
  alerts = await call('/api/alerts', { token: adminToken });
  check('clearing the flag closes the integrity alert',
    !alerts.body?.alerts?.some((a) => a.userId === officerId && a.type === 'integrity'));

  // 13. Deactivation takes effect immediately (same token stops working)
  await call(`/api/officers/${officerId}/activation`, { method: 'PUT', token: adminToken, body: { isActive: false } });
  const afterDeactivate = await call('/api/tracking/standing', { token: officerToken });
  check('deactivated officer token is rejected at once', afterDeactivate.status === 403, `got ${afterDeactivate.status}`);

  // 14. Cleanup
  const db = new Client(process.env.DATABASE_URL);
  await db.connect();
  const del = await db.query('DELETE FROM users WHERE id = $1', [officerId]);
  await db.end();
  check('test officer cleaned up', del.rowCount === 1);

  console.log(`\n${failed === 0 ? '✓ ALL PASSED' : '✗ FAILURES'} — ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('\nE2E run crashed:', err.message);
  process.exit(1);
});
