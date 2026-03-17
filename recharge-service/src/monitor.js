require('dotenv').config();
const config = require('./config');
const logger = require('./utils/logger');
const { initializeDatabase } = require('./models/database');
const BlockchainMonitor = require('./services/blockchain');

async function startMonitor() {
  try {
    logger.info('Starting recharge monitor (standalone mode)...');
    
    // Initialize database
    await initializeDatabase();
    
    // Initialize and start blockchain monitor
    const monitor = new BlockchainMonitor();
    await monitor.initialize();
    await monitor.start();
    
    logger.info('Monitor started successfully');
    logger.info(`Watching wallet: ${config.wallet.address}`);
    logger.info(`Tokens: USDT (${config.tokens.usdt.address}), USDC (${config.tokens.usdc.address})`);
    logger.info(`Exchange rate: 1 USD = ${config.exchange.chipsPerUsd} chips`);
    
  } catch (error) {
    logger.error('Failed to start monitor', { error: error.message });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Shutting down monitor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Shutting down monitor...');
  process.exit(0);
});

startMonitor();
