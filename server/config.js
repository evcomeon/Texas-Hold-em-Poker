// ============================================================
// Centralized Server Configuration
// ============================================================

require('dotenv').config();

function getString(name, fallback) {
  return process.env[name] !== undefined ? process.env[name] : fallback;
}

function getInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = parseInt(raw, 10);
  return Number.isNaN(value) ? fallback : value;
}

function getFloat(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = parseFloat(raw);
  return Number.isNaN(value) ? fallback : value;
}

const config = {
  app: {
    nodeEnv: getString('NODE_ENV', 'development'),
    port: getInt('PORT', 3001),
  },
  logging: {
    level: getString('LOG_LEVEL', 'info'),
  },
  jwt: {
    secret: getString('JWT_SECRET', 'super_secret_poker_key_2026'),
    expiresIn: getString('JWT_EXPIRES_IN', '365d'),
  },
  google: {
    clientId: getString('GOOGLE_CLIENT_ID', ''),
  },
  db: {
    host: getString('DB_HOST', getString('PGHOST', 'localhost')),
    port: getInt('DB_PORT', getInt('PGPORT', 5432)),
    database: getString('DB_NAME', getString('PGDATABASE', 'poker_game')),
    user: getString('DB_USER', getString('PGUSER', 'postgres')),
    password: getString('DB_PASSWORD', getString('PGPASSWORD', 'postgres')),
    max: getInt('DB_POOL_MAX', 20),
    idleTimeoutMs: getInt('DB_IDLE_TIMEOUT_MS', 30000),
    connectionTimeoutMs: getInt('DB_CONNECTION_TIMEOUT_MS', 2000),
  },
  redis: {
    host: getString('REDIS_HOST', 'localhost'),
    port: getInt('REDIS_PORT', 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  game: {
    minPlayers: getInt('GAME_MIN_PLAYERS', 2),
    maxPlayers: getInt('GAME_MAX_PLAYERS', 8),
    defaultStartingChips: getInt('GAME_DEFAULT_STARTING_CHIPS', 1000),
    turnTimeoutSeconds: getInt('TURN_TIMEOUT', 30),
    readyTimeoutSeconds: getInt('READY_TIMEOUT', 30),
    stakeLevels: {
      low: {
        smallBlind: getInt('LOW_SMALL_BLIND', 5),
        bigBlind: getInt('LOW_BIG_BLIND', 10),
        name: getString('LOW_STAKE_NAME', '低注桌'),
      },
      medium: {
        smallBlind: getInt('MEDIUM_SMALL_BLIND', 10),
        bigBlind: getInt('MEDIUM_BIG_BLIND', 20),
        name: getString('MEDIUM_STAKE_NAME', '中注桌'),
      },
      high: {
        smallBlind: getInt('HIGH_SMALL_BLIND', 25),
        bigBlind: getInt('HIGH_BIG_BLIND', 50),
        name: getString('HIGH_STAKE_NAME', '高注桌'),
      },
    },
  },
  recharge: {
    chipsPerUsd: getInt('CHIPS_PER_USD', 10000),
    minAmount: getFloat('MIN_RECHARGE_AMOUNT', 1),
    maxAmount: getFloat('MAX_RECHARGE_AMOUNT', 0),
    walletAddress: getString('RECHARGE_WALLET_ADDRESS', '0x0000000000000000000000000000000000000000'),
    usdtAddress: getString('USDT_CONTRACT_ADDRESS', '0xdAC17F958D2ee523a2206206994597C13D831ec7'),
    usdcAddress: getString('USDC_CONTRACT_ADDRESS', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    rpcUrl: getString('RPC_URL', 'https://eth.llamarpc.com'),
    confirmationBlocks: getInt('CONFIRMATION_BLOCKS', 3),
    orderCheckIntervalMs: getInt('ORDER_CHECK_INTERVAL', 5000),
  },
};

module.exports = config;
