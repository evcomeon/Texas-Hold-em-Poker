const express = require('express');
const router = express.Router();
const RechargeOrder = require('../models/recharge');
const WalletModel = require('../models/wallet');
const UserModel = require('../models/user');
const logger = require('../lib/logger');
const config = require('../config');

const RECHARGE_CONFIG = {
  CHIPS_PER_USD: config.recharge.chipsPerUsd,
  MIN_AMOUNT: config.recharge.minAmount,
  MAX_AMOUNT: config.recharge.maxAmount,
  WALLET_ADDRESS: config.recharge.walletAddress,
  USDT_ADDRESS: config.recharge.usdtAddress,
  USDC_ADDRESS: config.recharge.usdcAddress,
  CONFIRMATION_BLOCKS: config.recharge.confirmationBlocks
};

router.get('/config', (req, res) => {
  res.json({
    walletAddress: RECHARGE_CONFIG.WALLET_ADDRESS,
    tokens: {
      USDT: {
        address: RECHARGE_CONFIG.USDT_ADDRESS,
        decimals: 6,
        symbol: 'USDT'
      },
      USDC: {
        address: RECHARGE_CONFIG.USDC_ADDRESS,
        decimals: 6,
        symbol: 'USDC'
      }
    },
    exchangeRate: RECHARGE_CONFIG.CHIPS_PER_USD,
    minAmount: RECHARGE_CONFIG.MIN_AMOUNT,
    maxAmount: RECHARGE_CONFIG.MAX_AMOUNT,
    confirmationBlocks: RECHARGE_CONFIG.CONFIRMATION_BLOCKS
  });
});

router.post('/create', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: '请先登录' });
    }
    
    const authToken = authHeader.split(' ')[1];
    const { verifyJWT } = require('../auth');
    let decoded;
    try {
      decoded = verifyJWT(authToken);
    } catch (e) {
      return res.status(401).json({ error: 'Token无效或已过期' });
    }
    
    const userId = decoded.id;
    
    const { tokenSymbol, tokenAmount, token, amount } = req.body;
    const finalToken = tokenSymbol || token;
    const finalAmount = tokenAmount || amount;
    
    if (!finalToken || !finalAmount) {
      return res.status(400).json({ error: '请提供代币类型和数量' });
    }
    
    if (!['USDT', 'USDC', 'ETH'].includes(finalToken)) {
      return res.status(400).json({ error: '不支持的代币类型' });
    }
    
    const numAmount = parseFloat(finalAmount);
    
    if (isNaN(numAmount) || numAmount < RECHARGE_CONFIG.MIN_AMOUNT) {
      return res.status(400).json({ 
        error: `最小充值金额为 ${RECHARGE_CONFIG.MIN_AMOUNT} ${finalToken}` 
      });
    }
    
    if (RECHARGE_CONFIG.MAX_AMOUNT > 0 && numAmount > RECHARGE_CONFIG.MAX_AMOUNT) {
      return res.status(400).json({ 
        error: `最大充值金额为 ${RECHARGE_CONFIG.MAX_AMOUNT} ${finalToken}` 
      });
    }
    
    let wallet = await WalletModel.findByUserId(userId);
    let walletAddress = wallet?.wallet_address;
    
    if (!walletAddress) {
      const user = await UserModel.findById(userId);
      walletAddress = user?.wallet_address;
    }
    
    const chipsAmount = Math.floor(numAmount * RECHARGE_CONFIG.CHIPS_PER_USD);
    
    const order = await RechargeOrder.create({
      userId,
      walletAddress: walletAddress || 'unknown',
      tokenSymbol: finalToken,
      tokenAmount: numAmount,
      chipsAmount,
      toAddress: RECHARGE_CONFIG.WALLET_ADDRESS
    });
    
    res.json({
      success: true,
      orderId: order.order_no,
      orderNo: order.order_no,
      token: finalToken,
      amount: numAmount,
      chips: chipsAmount,
      depositAddress: RECHARGE_CONFIG.WALLET_ADDRESS,
      order: {
        orderNo: order.order_no,
        tokenSymbol: order.token_symbol,
        tokenAmount: parseFloat(order.token_amount),
        chipsAmount: order.chips_amount,
        toAddress: order.to_address,
        fromAddress: walletAddress,
        status: order.status,
        createdAt: order.created_at
      }
    });
    
  } catch (error) {
    logger.error('recharge.create_order_failed', { error });
    res.status(500).json({ error: error.message || '创建订单失败' });
  }
});

router.post('/submit-tx', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: '请先登录' });
    }
    
    const authToken = authHeader.split(' ')[1];
    const { verifyJWT } = require('../auth');
    let decoded;
    try {
      decoded = verifyJWT(authToken);
    } catch (e) {
      return res.status(401).json({ error: 'Token无效或已过期' });
    }
    
    const userId = decoded.id;
    const { orderId, txHash } = req.body;
    
    if (!orderId || !txHash) {
      return res.status(400).json({ error: '请提供订单号和交易哈希' });
    }
    
    const order = await RechargeOrder.findByOrderNo(orderId);
    
    if (!order) {
      return res.status(404).json({ error: '订单不存在' });
    }
    
    if (order.user_id !== userId) {
      return res.status(403).json({ error: '无权操作此订单' });
    }
    
    if (order.status !== 'pending') {
      return res.status(400).json({ error: '订单状态不正确' });
    }
    
    const existingTx = await RechargeOrder.findByTxHash(txHash);
    if (existingTx) {
      return res.status(400).json({ error: '该交易哈希已被使用' });
    }
    
    await RechargeOrder.updateTxHash(orderId, txHash);
    
    res.json({
      success: true,
      message: '交易哈希已提交，等待确认'
    });
    
  } catch (error) {
    logger.error('recharge.submit_tx_failed', { error });
    res.status(500).json({ error: error.message || '提交失败' });
  }
});

router.get('/status/:orderId', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: '请先登录' });
    }
    
    const authToken = authHeader.split(' ')[1];
    const { verifyJWT } = require('../auth');
    let decoded;
    try {
      decoded = verifyJWT(authToken);
    } catch (e) {
      return res.status(401).json({ error: 'Token无效或已过期' });
    }
    
    const { orderId } = req.params;
    
    const order = await RechargeOrder.findByOrderNo(orderId);
    
    if (!order) {
      return res.status(404).json({ error: '订单不存在' });
    }
    
    res.json({
      status: order.status,
      orderNo: order.order_no,
      tokenSymbol: order.token_symbol,
      tokenAmount: parseFloat(order.token_amount),
      chipsAmount: order.chips_amount,
      txHash: order.tx_hash,
      createdAt: order.created_at,
      confirmedAt: order.confirmed_at
    });
    
  } catch (error) {
    logger.error('recharge.get_status_failed', { orderId: req.params.orderId, error });
    res.status(500).json({ error: '查询状态失败' });
  }
});

router.get('/history', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: '请先登录' });
    }
    
    const authToken = authHeader.split(' ')[1];
    const { verifyJWT } = require('../auth');
    let decoded;
    try {
      decoded = verifyJWT(authToken);
    } catch (e) {
      return res.status(401).json({ error: 'Token无效或已过期' });
    }
    
    const userId = decoded.id;
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    
    const orders = await RechargeOrder.findByUserId(userId, limit, offset);
    
    res.json({
      orders: orders.map(o => ({
        orderNo: o.order_no,
        tokenSymbol: o.token_symbol,
        tokenAmount: parseFloat(o.token_amount),
        chipsAmount: o.chips_amount,
        txHash: o.tx_hash,
        status: o.status,
        createdAt: o.created_at,
        confirmedAt: o.confirmed_at
      }))
    });
    
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ error: '获取历史记录失败' });
  }
});

module.exports = router;
