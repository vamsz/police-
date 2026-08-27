'use strict';

const { assertValid, config } = require('./config');
const logger = require('./lib/logger');

function main() {
  try {
    assertValid();
  } catch (err) {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }

  const { createApp } = require('./http/app');
  const { pool } = require('./db/pool');
  const monitor = require('./services/monitor.service');

  const server = createApp().listen(config.port, () => {
    logger.info('Server listening', { port: config.port, env: config.env });
    if (!config.maps.apiKey) {
      logger.warn('GOOGLE_MAPS_API_KEY is not set - map views will show a setup notice');
    }
    monitor.start();
  });

  const shutdown = (signal) => {
    logger.info('Shutting down', { signal });
    monitor.stop();
    server.close(() => pool.end().then(() => process.exit(0)));
    // Do not let a hung connection hold the process open forever.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
  });
}

main();
