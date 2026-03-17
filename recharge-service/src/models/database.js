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
  
  // FIX: 创建系统设置表（用于存储最后处理的区块号）
  await query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // FIX: 创建交易记录表（如果不存在）
  await query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      type VARCHAR(20) NOT NULL,
      amount INTEGER NOT NULL,
      balance_before INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      description VARCHAR(255),
      idempotency_key VARCHAR(64) UNIQUE,
      status VARCHAR(20) DEFAULT 'completed',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // FIX: 创建幂等性键索引
  await query(`
    CREATE INDEX IF NOT EXISTS idx_transactions_idempotency_key ON transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;
  `);
  
  // Create recharge transactions table if not exists
  await query(`
    CREATE TABLE IF NOT EXISTS recharge_transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- FIX: 允许NULL用于未认领的充值
      order_no VARCHAR(32),  -- FIX: 订单号
      tx_hash VARCHAR(66) UNIQUE,  -- FIX: 交易哈希（允许NULL用于先创建订单后提交txHash）
      token_symbol VARCHAR(10) NOT NULL,
      token_amount NUMERIC(78, 18) NOT NULL,  -- FIX: 使用DECIMAL支持更多小数位
      chips_amount INTEGER NOT NULL,
      from_address VARCHAR(42),
      to_address VARCHAR(42),
      block_number BIGINT,
      confirmations INTEGER DEFAULT 0,
      status VARCHAR(20) DEFAULT 'pending',  -- pending, processing, completed, failed, unclaimed
      fail_reason VARCHAR(255),  -- FIX: 失败原因
      processed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // Create indexes for faster queries
  await query(`
    CREATE INDEX IF NOT EXISTS idx_recharge_user_id ON recharge_transactions(user_id);
  `);
  
  await query(`
    CREATE INDEX IF NOT EXISTS idx_recharge_order_no ON recharge_transactions(order_no);
  `);
  
  await query(`
    CREATE INDEX IF NOT EXISTS idx_recharge_tx_hash ON recharge_transactions(tx_hash) WHERE tx_hash IS NOT NULL;
  `);
  
  await query(`
    CREATE INDEX IF NOT EXISTS idx_recharge_status ON recharge_transactions(status);
  `);
  
  await query(`
    CREATE INDEX IF NOT EXISTS idx_recharge_from_address ON recharge_transactions(from_address) WHERE from_address IS NOT NULL;
  `);
  
  await query(`
    CREATE INDEX IF NOT EXISTS idx_recharge_created_at ON recharge_transactions(created_at);
  `);
  
  // FIX: 创建用户钱包表（用于钱包地址查询）
  await query(`
    CREATE TABLE IF NOT EXISTS user_wallets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      wallet_address VARCHAR(42) NOT NULL UNIQUE,
      wallet_type VARCHAR(20) DEFAULT 'metamask',
      is_primary BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_used_at TIMESTAMP
    );
  `);
  
  await query(`
    CREATE INDEX IF NOT EXISTS idx_user_wallets_user_id ON user_wallets(user_id);
  `);
  
  logger.info('Database schema initialized successfully');
}

module.exports = {
  query,
  getClient,
  pool,
  initializeDatabase
};
