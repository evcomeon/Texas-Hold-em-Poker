// ============================================================
// Database Schema Initialization
// ============================================================

const { query } = require('./index');

async function initializeDatabase() {
  console.log('🔧 Initializing database schema...');

  // 用户表
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      google_id VARCHAR(255) UNIQUE,
      username VARCHAR(50) NOT NULL UNIQUE,
      email VARCHAR(255) UNIQUE,
      password VARCHAR(255),
      avatar_url VARCHAR(500),
      chips_balance INTEGER DEFAULT 10000,
      total_games INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      total_winnings BIGINT DEFAULT 0,
      level INTEGER DEFAULT 1,
      experience INTEGER DEFAULT 0,
      is_guest BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login_at TIMESTAMP,
      is_banned BOOLEAN DEFAULT FALSE,
      ban_reason VARCHAR(255)
    );
  `);

  // 游戏记录表
  await query(`
    CREATE TABLE IF NOT EXISTS game_records (
      id SERIAL PRIMARY KEY,
      room_id VARCHAR(100) NOT NULL,
      stake_level VARCHAR(20) NOT NULL,
      small_blind INTEGER NOT NULL,
      big_blind INTEGER NOT NULL,
      hand_number INTEGER NOT NULL,
      community_cards TEXT[],
      pot INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 游戏参与者表
  await query(`
    CREATE TABLE IF NOT EXISTS game_participants (
      id SERIAL PRIMARY KEY,
      game_record_id INTEGER REFERENCES game_records(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      player_name VARCHAR(50) NOT NULL,
      hole_cards TEXT[],
      final_hand VARCHAR(100),
      bet_amount INTEGER DEFAULT 0,
      won_amount INTEGER DEFAULT 0,
      is_winner BOOLEAN DEFAULT FALSE,
      position INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 充值记录表
  await query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(20) NOT NULL,
      amount INTEGER NOT NULL,
      balance_before INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      description VARCHAR(255),
      payment_method VARCHAR(50),
      payment_id VARCHAR(255),
      status VARCHAR(20) DEFAULT 'completed',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 创建索引
  await query(`CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_game_records_room_id ON game_records(room_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_game_records_created_at ON game_records(created_at);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_game_participants_user_id ON game_participants(user_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_game_participants_game_record_id ON game_participants(game_record_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);`);

  // 用户钱包表
  await query(`
    CREATE TABLE IF NOT EXISTS user_wallets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      wallet_address VARCHAR(42) NOT NULL UNIQUE,
      wallet_type VARCHAR(20) DEFAULT 'metamask',
      is_primary BOOLEAN DEFAULT TRUE,
      nonce VARCHAR(64),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_used_at TIMESTAMP
    );
  `);
  
  await query(`CREATE INDEX IF NOT EXISTS idx_user_wallets_user_id ON user_wallets(user_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_user_wallets_address ON user_wallets(wallet_address);`);

  // 充值订单表
  await query(`
    CREATE TABLE IF NOT EXISTS recharge_orders (
      id SERIAL PRIMARY KEY,
      order_no VARCHAR(32) NOT NULL UNIQUE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      wallet_address VARCHAR(42) NOT NULL,
      token_symbol VARCHAR(10) NOT NULL,
      token_amount DECIMAL(78, 18) NOT NULL,
      chips_amount INTEGER NOT NULL,
      tx_hash VARCHAR(66) UNIQUE,
      to_address VARCHAR(42) NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      fail_reason VARCHAR(255),
      confirmed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  await query(`CREATE INDEX IF NOT EXISTS idx_recharge_orders_user_id ON recharge_orders(user_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_recharge_orders_order_no ON recharge_orders(order_no);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_recharge_orders_tx_hash ON recharge_orders(tx_hash);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_recharge_orders_status ON recharge_orders(status);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_recharge_orders_created_at ON recharge_orders(created_at);`);

  // API Keys 表 - 用于外部程序接入
  await query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      key_hash VARCHAR(128) NOT NULL UNIQUE,
      key_prefix VARCHAR(8) NOT NULL,
      name VARCHAR(100) NOT NULL,
      description VARCHAR(500),
      permissions JSONB DEFAULT '["read"]',
      rate_limit INTEGER DEFAULT 100,
      is_active BOOLEAN DEFAULT TRUE,
      last_used_at TIMESTAMP,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix);`);

  // 钱包绑定 Nonce 表 - 用于绑定验证
  await query(`
    CREATE TABLE IF NOT EXISTS wallet_bind_nonces (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      wallet_address VARCHAR(42) NOT NULL,
      nonce VARCHAR(66) NOT NULL UNIQUE,
      purpose VARCHAR(20) NOT NULL DEFAULT 'bind',
      expires_at TIMESTAMP NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_wallet_bind_nonces_user_id ON wallet_bind_nonces(user_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_wallet_bind_nonces_expires ON wallet_bind_nonces(expires_at);`);

  console.log('✅ Database schema initialized');
}

async function dropAllTables() {
  console.log('⚠️ Dropping all tables...');
  await query('DROP TABLE IF EXISTS transactions CASCADE;');
  await query('DROP TABLE IF EXISTS game_participants CASCADE;');
  await query('DROP TABLE IF EXISTS game_records CASCADE;');
  await query('DROP TABLE IF EXISTS users CASCADE;');
  console.log('✅ All tables dropped');
}

module.exports = {
  initializeDatabase,
  dropAllTables,
};
