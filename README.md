# Rally Deployment Tracker

Coordinates police officer deployment at rallies. A supervisor assigns each
officer a surveillance point on the map; officers' phones report their position;
the console shows everyone live and raises an alert when someone leaves their
assigned area, stops reporting, or sends a position that looks falsified.

---

## What it can and cannot do

**It can** post officers to points on a map, track them live, alert on breaches,
and keep an auditable record of who was where.

**It cannot prove an officer is where their phone says they are.** This is a web
app: the position arrives as JSON from a browser nobody controls, and a browser
cannot see Android mock-location apps or Developer Options the way a native app
could. The integrity checks in `src/domain/integrity.js` catch *careless* faking
— a mock app pinned to one coordinate, a jump across the city, a tampered device
clock — and nothing more. Treat a flag as a reason to phone the officer, never as
proof. Closing this gap properly needs a native Android app using
`Location.isMock` and Play Integrity.

---

## Quick start

Requires Node 20+ and PostgreSQL 14+.

```bash
createdb police_rally

cd backend
cp .env.example .env      # then fill in the blanks - see below
npm install
npm run migrate
npm run seed              # optional: demo officers, posts, and an alert
npm start
```

Open <http://localhost:4000>.

> **Already set up on this machine.** The system PostgreSQL on port 5432 uses a
> password we did not have, so the project was pointed at a dedicated,
> password-free cluster on **port 5433** that lives in your user profile
> (`%LOCALAPPDATA%\rally-pg`) and does not touch your 5432 install. It is
> migrated and seeded. The data survives reboots, but the server process does
> not — bring it back up after a restart with:
>
> ```powershell
> powershell -File backend\scripts\start-db.ps1
> ```
>
> then `npm start` in `backend`. Demo logins: supervisor `+919000000100` /
> `admin1234`, officers `+919000000101…105` / `officer123`. To switch to the
> standard 5432 install later, just change `DATABASE_URL` in `backend/.env`.

### Filling in `.env`

Four values have no default and the server refuses to boot without them:

| Variable | How to produce one |
| --- | --- |
| `DATABASE_URL` | Your Postgres connection string. |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ADMIN_REGISTRATION_CODE` | Any secret ≥ 8 characters. Share only with supervisors. |
| `OFFICER_REGISTRATION_CODE` | Any secret ≥ 8 characters. Share with officers. |

`GOOGLE_MAPS_API_KEY` is optional — without it tracking still works and the map
area shows a setup notice. To enable it: Google Cloud Console → enable **Maps
JavaScript API** → create a key → restrict it to your domain.

Every tuning value (report interval, radius defaults, alert thresholds) is
documented inline in `.env.example`.

### Registration is closed

There is no open sign-up. A new account must present one of the two registration
codes, and which code decides whether the account is an officer or a supervisor.
Rotate the codes whenever someone leaves the unit.

---

## How it works

```
Officer's browser                 Server                        Supervisor's console
─────────────────                 ──────                        ────────────────────
watchPosition()
  │  newest fix held,
  │  sent on a timer
  ▼
POST /api/tracking/fixes ───▶ tracking.service
                                │  domain/integrity → flags?
                                │  domain/radius    → outside?
                                │  one transaction:
                                │    store fix
                                │    open / refresh / resolve alerts
                                ▼
                              PostgreSQL ◀─── GET /api/officers  (polled)
                                  ▲                GET /api/alerts
                                  │
                           monitor.service
                        (sweeps for officers
                         who stopped reporting)
```

### The judgement calls worth knowing about

**GPS error is forgiven before a breach is called.** Urban phone accuracy is
10–30 m, often worse beside buildings. A raw `distance > radius` test alerts
constantly on officers who never moved. The reported accuracy is subtracted from
the measured distance before judging, capped at `ACCURACY_GRACE_CAP_METERS` so a
vague fix cannot excuse any distance. A fix vaguer than
`MAX_USABLE_ACCURACY_METERS` is recorded but never used as evidence of a breach.

**An alert is an incident, not a ping.** A partial unique index —
`alerts (user_id, type) WHERE status = 'open'` — makes it impossible for one
officer to hold two open alerts of the same kind. Repeat breaches bump
`occurrences` on the existing row. Walking back inside auto-resolves it.
Integrity alerts are the exception: they only close when a supervisor clears
them, because that is the entire point of raising one.

**Speed is measured against server receipt time**, never the device clock. A
spoofer controls their own clock, so trusting it would let them claim any speed
they liked.

**Silence is its own alert.** An officer whose phone dies simply stops sending —
there is no request left to notice. `monitor.service` sweeps for assigned
officers who have gone quiet and raises `signal_lost`.

**Deactivation takes effect immediately.** `requireAuth` reloads the user on
every request, so switching off an account does not wait for its token to expire.

---

## Layout

```
backend/
  src/
    config/         env parsing + boot validation (refuses to start if unsafe)
    lib/            AppError, logger, asyncHandler, validate
    db/             pool, transaction helper, numbered migrations
    domain/         pure logic, no I/O: geo, radius, integrity, status
    repositories/   all SQL, aliased to camelCase at the query boundary
    services/       business logic; owns transactions
    http/           routes, middleware, app assembly
  test/             unit tests over the domain and validation layers
  scripts/seed.js   demo data

web/
  index.html officer.html admin.html
  assets/styles.css
  js/core/          api, session, dom, format, maps
  js/pages/         login, officer, admin
```

Dependencies point one way only: `http → services → repositories → db`, with
`domain/` depending on nothing. That is what makes the tracking rules testable
without a database.

### Tests

```bash
cd backend && npm test
```

40 unit tests covering distance and bearing maths, breach evaluation including
the accuracy-grace behaviour, every integrity heuristic, status precedence, and
input validation. They need no database.

---

## Using the console

1. Register the first account with the **admin** code, then have officers
   register with the **officer** code.
2. Click an officer in the roster. The panel switches to their detail — the map
   stays visible and live throughout.
3. Click **Assign post**, then click the map. Drag the purple marker to
   fine-tune, drag the slider to size the boundary, name the rally, and save.
4. Officers open the site on their phones, allow location, and appear on the map.

Keep the radius comfortably larger than phone GPS accuracy. Below about 50 m,
ordinary drift starts to look like a breach even with the accuracy grace.

---

## Production notes

- **HTTPS is not optional.** Browsers refuse the Geolocation API on insecure
  origins. Terminate TLS with nginx/Caddy or a platform like Render/Railway/Fly.
  `trust proxy` is already set for that.
- Restrict the Maps API key to your production domain.
- Set `NODE_ENV=production` — it suppresses stack traces in logs and blocks the
  seed script.
- Use managed Postgres with backups. Location history is pruned after
  `FIX_RETENTION_DAYS` (default 30).
- A real Content-Security-Policy is enforced in `src/http/app.js`. The frontend
  ships no inline scripts, so `script-src` stays strict.
- `CORS_ORIGINS` is empty by default: the API and UI are same-origin, so nothing
  cross-origin is permitted unless you configure it.

### Known limits

- Position spoofing, as described at the top. The honest fix is a native app.
- Polling, not push. The console refreshes every `ADMIN_POLL_SECONDS`; a
  WebSocket would be the next step if second-level latency matters.
- The `signal_lost` sweep runs in-process. Two server instances will both sweep —
  harmless, since the alert upsert is idempotent — but a scheduled job is the
  cleaner answer at that scale.
