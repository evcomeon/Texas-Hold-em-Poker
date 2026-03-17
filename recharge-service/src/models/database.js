const { Pool } = require('pg');
const config = require('../config');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: config.database.connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  logger.error('Unexpected database error', err);
});

async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { duration, rows: result.rowCount });
    return result;
  } catch (error) {
    logger.error('Database query error', { error: error.message, text });
    throw error;
  }
}

async function getClient() {
  return await pool.connect();
}

async function initializeDatabase() {
  logger.info('Initializing recharge service database schema...');
  
  // Create recharge transactions table if not exists
  await query(`
    CREATE TABLE IF NOT EXISTS recharge_transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tx_hash VARCHAR(66) NOT NULL UNIQUE,
      token_symbol VARCHAR(10) NOT NULL,
      token_amount NUMERIC(78, 0) NOT NULL,
      chips_amount INTEGER NOT NULL,
      from_address VARCHAR(42) NOT NULL,
      to_address VARCHAR(42) NOT NULL,
      block_number BIGINT,
      confirmations INTEGER DEFAULT 0,
      status VARCHAR(20) DEFAULT 'pending',
      processed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // Create index for faster queries
  await query(`
    CREATE INDEX IF NOT EXISTS idx_recharge_user_id ON recharge_transactions(user_id);
  `);
  
  await query(`
    CREATE INDEX IF NOT EXISTS idx_recharge_tx_hash ON recharge_transactions(tx_hash);
  `);
  
  await query(`
    CREATE INDEX IF NOT EXISTS idx_recharge_status ON recharge_transactions(status);
  `);
  
  logger.info('Database schema initialized successfully');
}

module.exports = {
  query,
  getClient,
  pool,
  initializeDatabase
};
