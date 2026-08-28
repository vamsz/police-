'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { config } = require('../config');
const routes = require('./routes');
const { auditLog } = require('./middleware/auditLog');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const WEB_ROOT = path.join(__dirname, '..', '..', '..', 'web');

/**
 * A real Content-Security-Policy rather than a disabled one. The frontend ships
 * no inline scripts, so script-src stays strict; Google Maps needs its own origins
 * for the loader, tiles, and marker images, and injects inline styles of its own.
 */
const contentSecurityPolicy = {
  useDefaults: true,
  directives: {
    'default-src': ["'self'"],
    'script-src': ["'self'", 'https://maps.googleapis.com', 'https://maps.gstatic.com'],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'blob:', 'https://maps.googleapis.com', 'https://maps.gstatic.com', 'https://*.googleapis.com', 'https://*.ggpht.com'],
    'connect-src': ["'self'", 'https://maps.googleapis.com'],
    'worker-src': ["'self'", 'blob:'],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  },
};

function createApp() {
  const app = express();

  app.set('trust proxy', 1); // behind nginx/Caddy/a platform proxy in production
  app.disable('x-powered-by');
  app.disable('etag'); // API responses are per-user; no shared caching

  app.use(
    helmet({
      contentSecurityPolicy,
      crossOriginEmbedderPolicy: false,
      // Two years, subdomains included, preload-eligible. Once a browser has seen
      // this over HTTPS it refuses to talk to the origin over plain HTTP.
      hsts: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  // Lock down powerful browser features. Officers need geolocation; nothing here
  // needs camera, microphone, or payment, so those are denied to the whole origin.
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()');
    next();
  });

  // The API and the UI are served from the same origin, so cross-origin access is
  // only opened up where it is explicitly configured.
  const allowedOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (allowedOrigins.length) app.use(cors({ origin: allowedOrigins, credentials: false }));

  app.use(express.json({ limit: '16kb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) }));

  app.use('/api', auditLog, routes);

  app.use(express.static(WEB_ROOT, { extensions: ['html'], maxAge: config.isProduction ? '1h' : 0 }));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
