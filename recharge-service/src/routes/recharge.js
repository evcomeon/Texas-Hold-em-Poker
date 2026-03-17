const express = require('express');
const router = express.Router();
const config = require('../config');
const RechargeTransaction = require('../models/recharge');
const User = require('../models/user');
const BlockchainMonitor = require('../services/blockchain');
const logger = require('../utils/logger');

// Middleware to verify API key
function verifyApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== config.security.apiSecretKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
}

// Get recharge configuration
router.get('/config', (req, res) => {
  res.json({
    walletAddress: config.wallet.address,
    tokens: {
      usdt: {
        address: config.tokens.usdt.address,
        symbol: config.tokens.usdt.symbol,
        decimals: config.tokens.usdt.decimals
      },
      usdc: {
        address: config.tokens.usdc.address,
        symbol: config.tokens.usdc.symbol,
        decimals: config.tokens.usdc.decimals
      }
    },
    exchangeRate: config.exchange.chipsPerUsd,
    minAmount: config.exchange.minRechargeAmount,
    maxAmount: config.exchange.maxRechargeAmount,
    confirmationBlocks: config.blockchain.confirmationBlocks
  });
});

// Get user balance
router.get('/balance/:userId', verifyApiKey, async (req, res) => {
  try {
    const balance = await User.getBalance(req.params.userId);
    res.json({ 
      userId: req.params.userId,
      balance,
      balanceFormatted: balance.toLocaleString()
    });
  } catch (error) {
    logger.error('Failed to get balance', { error: error.message });
    res.status(500).json({ error: 'Failed to get balance' });
  }
});

// Get recharge history for user
router.get('/history/:userId', verifyApiKey, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    
    const transactions = await RechargeTransaction.findByUserId(
      req.params.userId, 
      limit, 
      offset
    );
    
    res.json({ transactions });
  } catch (error) {
    logger.error('Failed to get history', { error: error.message });
    res.status(500).json({ error: 'Failed to get history' });
  }
});

// Check transaction status
router.get('/check/:txHash', async (req, res) => {
  try {
    // First check database
    const dbTx = await RechargeTransaction.findByTxHash(req.params.txHash);
    if (dbTx) {
      return res.json({
        status: dbTx.status,
        transaction: dbTx
      });
    }
    
    // Check blockchain
    const monitor = req.app.locals.blockchainMonitor;
    if (monitor) {
      const result = await monitor.checkTransaction(req.params.txHash);
      return res.json(result);
    }
    
    res.json({ status: 'unknown' });
  } catch (error) {
    logger.error('Failed to check transaction', { error: error.message });
    res.status(500).json({ error: 'Failed to check transaction' });
  }
});

// Manual recharge (for admin/testing)
router.post('/manual', verifyApiKey, async (req, res) => {
  try {
    const { userId, txHash, tokenSymbol, tokenAmount } = req.body;
    
    if (!userId || !txHash || !tokenSymbol || !tokenAmount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Check if transaction already processed
    const existing = await RechargeTransaction.findByTxHash(txHash);
    if (existing) {
      return res.status(400).json({ error: 'Transaction already processed' });
    }
    
    // Calculate chips
    const chipsAmount = Math.floor(tokenAmount * config.exchange.chipsPerUsd);
    
    // Create recharge record
    const rechargeTx = await RechargeTransaction.create({
      userId,
      txHash,
      tokenSymbol,
      tokenAmount,
      chipsAmount,
      fromAddress: 'manual',
      toAddress: config.wallet.address,
      blockNumber: 0,
      status: 'pending'
    });
    
    // Process recharge
    const result = await User.addChips(
      userId,
      chipsAmount,
      txHash,
      tokenSymbol,
      tokenAmount
    );
    
    res.json({
      success: true,
      recharge: rechargeTx,
      result
    });
    
  } catch (error) {
    logger.error('Manual recharge failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get recharge statistics
router.get('/stats', verifyApiKey, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const stats = await RechargeTransaction.getStats(startDate, endDate);
    res.json(stats);
  } catch (error) {
    logger.error('Failed to get stats', { error: error.message });
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'recharge-service'
  });
});

module.exports = router;
