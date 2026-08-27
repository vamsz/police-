-- Core schema for the rally deployment tracker.

CREATE TABLE users (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  phone             TEXT NOT NULL UNIQUE,
  email             TEXT UNIQUE,
  password_hash     TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'officer' CHECK (role IN ('officer', 'admin')),
  badge_id          TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  integrity_flagged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX users_role_idx ON users (role);

CREATE TABLE assignments (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rally_name    TEXT NOT NULL,
  lat           DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng           DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  radius_meters INTEGER NOT NULL CHECK (radius_meters BETWEEN 10 AND 5000),
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_by    INTEGER NOT NULL REFERENCES users (id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ
);

-- The database itself guarantees an officer can never hold two live posts.
CREATE UNIQUE INDEX assignments_one_active_per_user_idx
  ON assignments (user_id) WHERE status = 'active';

CREATE TABLE location_fixes (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assignment_id   INTEGER REFERENCES assignments (id) ON DELETE SET NULL,
  lat             DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng             DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_meters DOUBLE PRECISION,
  speed_mps       DOUBLE PRECISION,
  distance_meters DOUBLE PRECISION,
  outside_radius  BOOLEAN NOT NULL DEFAULT FALSE,
  integrity_flags TEXT[] NOT NULL DEFAULT '{}',
  fixed_at        TIMESTAMPTZ NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX location_fixes_user_recent_idx ON location_fixes (user_id, recorded_at DESC);
CREATE INDEX location_fixes_recorded_idx ON location_fixes (recorded_at);

CREATE TABLE alerts (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assignment_id INTEGER REFERENCES assignments (id) ON DELETE SET NULL,
  type          TEXT NOT NULL CHECK (type IN ('out_of_radius', 'integrity', 'signal_lost')),
  severity      TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning', 'critical')),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  message       TEXT NOT NULL,
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurrences   INTEGER NOT NULL DEFAULT 1,
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   INTEGER REFERENCES users (id),
  resolution    TEXT
);

-- One open incident per officer per type. Repeat breaches update the open row
-- instead of flooding the console with a new alert on every GPS ping.
CREATE UNIQUE INDEX alerts_one_open_per_user_type_idx
  ON alerts (user_id, type) WHERE status = 'open';

CREATE INDEX alerts_open_recent_idx ON alerts (status, last_seen_at DESC);
