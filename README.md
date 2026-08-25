# Rally Deployment Tracker

Web app for coordinating police officer deployment at rallies. Admin/DGP assigns
each officer a surveillance point on the map; officers' browsers report live
location; admin sees everyone on a Google Map and gets alerts if an officer
moves outside their assigned radius.

## Stack
- Backend: Node.js + Express + PostgreSQL, JWT auth
- Frontend: plain HTML/CSS/JS + Google Maps JavaScript API (no build step)

## Important limitation
This is a **web app**, so officer tracking uses the browser's Geolocation API.
A browser cannot detect Android mock-location apps or read Developer Options —
that requires a native app. The backend flags obviously-implausible signals
(zero accuracy, teleport-speed jumps) as best-effort anomaly detection, not
guaranteed spoof-proofing.

## Setup

1. Install PostgreSQL, create a database:
   ```
   createdb police_rally
   ```
2. Backend:
   ```
   cd backend
   cp .env.example .env
   ```
   Edit `.env`:
   - `DATABASE_URL` — your Postgres connection string
   - `JWT_SECRET` — any long random string
   - `GOOGLE_MAPS_API_KEY` — a Google Maps JavaScript API key (enable "Maps JavaScript API" in Google Cloud Console, restrict it to your domain for production)
   - `ADMIN_REGISTRATION_CODE` — a secret code you'll share only with people who should be able to register as admin

   Then:
   ```
   npm install
   npm run migrate
   npm start
   ```
3. Open `http://localhost:4000` in a browser. Register the first admin account
   (check "Registering as admin" and enter the admin code from `.env`), then
   have officers register as normal accounts.

## Production notes
- Put this behind HTTPS (required for Geolocation API on most browsers) —
  e.g. a reverse proxy (nginx/Caddy) with a TLS cert, or a platform like
  Render/Railway/Fly that terminates TLS for you.
- Restrict the Google Maps API key to your production domain in Google Cloud Console.
- Set a strong, unique `JWT_SECRET` and `ADMIN_REGISTRATION_CODE`.
- Use a managed Postgres instance with backups.
