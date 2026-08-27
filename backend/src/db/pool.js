'use strict';

const { Pool } = require('pg');
const { config } = require('../config');
const logger = require('../lib/logger');

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // An idle client failing is not tied to any request, so it can only be logged.
  logger.error('Idle database client error', { error: err.message });
});

/**
 * Runs `fn` inside a transaction, passing it a dedicated client. Any throw rolls
 * the whole unit of work back, so a location fix can never be recorded without
 * its matching alert bookkeeping.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction, query: (...args) => pool.query(...args) };
