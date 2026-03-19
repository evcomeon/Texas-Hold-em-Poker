// ============================================================
// PostgreSQL Database Configuration
// ============================================================

const { Pool } = require('pg');
require('dotenv').config();
const logger = require('../lib/logger');
const config = require('../config');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: config.db.max,
  idleTimeoutMillis: config.db.idleTimeoutMs,
  connectionTimeoutMillis: config.db.connectionTimeoutMs,
});

pool.on('connect', () => {
  logger.info('db.connected');
});

pool.on('error', (err) => {
  logger.error('db.connection_error', { error: err });
});

async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 100) {
    logger.warn('db.slow_query', {
      sql: text.substring(0, 100),
      durationMs: duration,
      rowCount: res.rowCount,
    });
  }
  return res;
}

async function getClient() {
  const client = await pool.connect();
  return client;
}

module.exports = {
  pool,
  query,
  getClient,
};
