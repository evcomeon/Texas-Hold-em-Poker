require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const logger = require('./utils/logger');
const { initializeDatabase } = require('./models/database');
const BlockchainMonitor = require('./services/blockchain');
const rechargeRoutes = require('./routes/recharge');

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  logger.debug('Incoming request', {
    method: req.method,
    path: req.path,
    ip: req.ip
  });
  next();
});

// Routes
app.use('/api/recharge', rechargeRoutes);

// Error handling
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

async function startServer() {
  try {
    // Initialize database
    await initializeDatabase();
    
    // Initialize blockchain monitor
    const blockchainMonitor = new BlockchainMonitor();
    await blockchainMonitor.initialize();
    
    // Store monitor in app locals for route access
    app.locals.blockchainMonitor = blockchainMonitor;
    
    // Start blockchain monitor
    await blockchainMonitor.start();
    
    // Start HTTP server
    app.listen(config.server.port, () => {
      logger.info(`Recharge service running on port ${config.server.port}`);
      logger.info(`Environment: ${config.server.nodeEnv}`);
      logger.info(`Exchange rate: 1 USD = ${config.exchange.chipsPerUsd} chips`);
    });
    
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  if (app.locals.blockchainMonitor) {
    app.locals.blockchainMonitor.stop();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  if (app.locals.blockchainMonitor) {
    app.locals.blockchainMonitor.stop();
  }
  process.exit(0);
});

startServer();
