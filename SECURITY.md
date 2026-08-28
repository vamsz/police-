# Security

This document describes the security posture of the Rally Deployment Tracker,
its threat model, the controls in place, the limitations you must accept, and how
to report a vulnerability.

## Reporting a vulnerability

Do **not** open a public issue for a security problem. Email the maintainers
privately with a description, reproduction steps, and impact. Expect an
acknowledgement within a few working days. Please give a reasonable window to
remediate before any public disclosure.

When reporting, describe the class of problem and how to reproduce it — do not
include a working exploit or a step-by-step data-extraction path.

## What this system protects

- **Officer roster and contact details** (name, phone, email, badge).
- **Live and historical location** of officers on duty.
- **Deployment orders** (who is posted where, at what radius).
- **The integrity of the alerting** that tells a supervisor an officer has left
  their post, gone silent, or is sending an implausible signal.

## Controls in place

**Authentication & sessions**
- Passwords hashed with bcrypt (`bcryptjs`, cost 12, configurable).
- JWT pinned to HS256 on both sign and verify, with issuer/audience checks — no
  algorithm-confusion foothold, no cross-service token replay.
- Every request re-loads the user from the database, so **deactivating an account
  takes effect immediately** rather than waiting for the token to expire.
- Login is constant-time against a dummy hash for unknown accounts, so responses
  cannot be used to enumerate registered numbers.

**Authorization**
- Role is derived from a registration code at sign-up, **never** taken from the
  request body — an officer cannot self-promote to admin.
- Admin endpoints require `role = 'admin'`; officer endpoints are role-locked.
- Officers can only read their own standing and assignment (no IDOR).

**Input & output**
- Every request body is validated and coerced against an explicit schema;
  undeclared fields are dropped (no mass assignment).
- All SQL uses parameterized queries — no string-built queries anywhere.
- The frontend builds DOM via `textContent`/element creation, never `innerHTML`,
  so officer-supplied text cannot execute in a supervisor's console.

**Transport & headers**
- A strict Content-Security-Policy (no inline scripts; `object-src 'none'`,
  `frame-ancestors 'none'`, `base-uri 'self'`).
- HSTS (2 years, `includeSubDomains`, `preload`), `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy` grants geolocation only to the origin itself and denies
  camera, microphone, payment, and USB.

**Abuse resistance**
- Rate limits on auth (20 / 15 min), on location reporting, and a general API
  backstop. Request bodies capped at 16 KB.
- A structured **audit trail**: one record per state-changing request — actor,
  action, source IP, and outcome — including failed logins, for brute-force
  detection. Location pings are excluded to keep the trail legible.

**Operational**
- Configuration is validated at boot; the process refuses to start with a missing
  secret or a leftover placeholder value.
- Secrets come from the environment and are never committed (`.env` is ignored).
- Container runs as an unprivileged user; dependency audit gate blocks builds
  with any high/critical advisory (currently **0 vulnerabilities**).

## Threat model & accepted limitations

**Location spoofing is not fully preventable in a web app.** The position is
reported as JSON by a browser we do not control, and a browser cannot see Android
mock-location apps or Developer Options the way a native app could. The integrity
heuristics (`src/domain/integrity.js`) catch *careless* faking — a mock app pinned
to one coordinate, a teleport across the city, a tampered device clock — and
nothing more. **Treat an integrity flag as a reason to phone the officer, never as
proof.** Closing this gap requires a native Android app using `Location.isMock`
and Play Integrity. This is documented, deliberate, and inherent to the platform.

**JWT is stored in `localStorage`.** This is a considered trade-off for a
no-build SPA. The compensating controls are a strict CSP and the total absence of
`innerHTML` sinks, which together make token theft via XSS the only realistic
vector and close that vector off. A future hardening is httpOnly cookies plus a
CSRF token; it is a larger change and is not yet done.

**Registration reveals whether a phone is already registered** (a 409 on
duplicate). This is gated behind a registration code, so only authorized people
can probe it. Accepted.

**Sessions last 12 hours** by default (configurable). Suitable for shift-based
use; shorten it and add refresh tokens if your policy requires.

## Deployment security checklist

- [ ] Serve only over **HTTPS** (browsers block the Geolocation API otherwise).
- [ ] Set strong, unique `JWT_SECRET` (≥ 32 chars) and registration codes; rotate
      codes when someone leaves the unit.
- [ ] Restrict the Google Maps API key to your domain and cap its daily quota.
- [ ] Run with `NODE_ENV=production` (suppresses stack traces, blocks the seed).
- [ ] Use managed Postgres with backups, or the compose volume with a backup job.
- [ ] Ship the audit log to a central, append-only store.
- [ ] Keep dependencies current; the CI audit gate fails on high/critical CVEs.
