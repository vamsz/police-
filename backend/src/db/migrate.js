'use strict';

const fs = require('fs/promises');
const path = require('path');
const { assertValid } = require('../config');
const logger = require('../lib/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function pendingMigrations(client) {
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await client.query('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  return files.filter((file) => !applied.has(file));
}

/**
 * Applies each pending migration in its own transaction, so a failure halfway
 * through a batch leaves the database on a known-good version.
 */
async function migrate() {
  assertValid();
  const { pool } = require('./pool');
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const pending = await pendingMigrations(client);

    if (!pending.length) {
      logger.info('Database is already up to date');
      return;
    }

    for (const file of pending) {
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info('Applied migration', { migration: file });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }

    logger.info('Migrations complete', { applied: pending.length });
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrate().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { migrate };
