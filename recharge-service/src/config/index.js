require('dotenv').config();

module.exports = {
  server: {
    port: parseInt(process.env.PORT) || 3002,
    nodeEnv: process.env.NODE_ENV || 'development'
  },
  
  database: {
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/poker_game'
  },
  
  blockchain: {
    network: process.env.ETHEREUM_NETWORK || 'mainnet',
    rpcUrl: process.env.RPC_URL || 'https://eth.llamarpc.com',
    confirmationBlocks: parseInt(process.env.CONFIRMATION_BLOCKS) || 3,
    pollingInterval: parseInt(process.env.POLLING_INTERVAL) || 5000
  },
  
  wallet: {
    address: process.env.RECHARGE_WALLET_ADDRESS,
    privateKey: process.env.RECHARGE_WALLET_PRIVATE_KEY
  },
  
  tokens: {
    usdt: {
      address: process.env.USDT_CONTRACT_ADDRESS,
      decimals: 6,
      symbol: 'USDT'
    },
    usdc: {
      address: process.env.USDC_CONTRACT_ADDRESS,
      decimals: 6,
      symbol: 'USDC'
    }
  },
  
  exchange: {
    chipsPerUsd: parseInt(process.env.CHIPS_PER_USD) || 10000,
    minRechargeAmount: parseFloat(process.env.MIN_RECHARGE_AMOUNT) || 1,
    maxRechargeAmount: parseFloat(process.env.MAX_RECHARGE_AMOUNT) || 0
  },
  
  security: {
    apiSecretKey: process.env.API_SECRET_KEY || 'default-secret-key-change-in-production'
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  }
};
