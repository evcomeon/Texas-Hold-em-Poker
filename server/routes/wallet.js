const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const WalletModel = require('../models/wallet');
const { generateJWT, verifyJWT } = require('../auth');
const logger = require('../lib/logger');

const NONCE_EXPIRE_SECONDS = 300;

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: '请先登录' });
  }
  
  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = verifyJWT(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token 无效或已过期' });
  }
};

// 获取签名消息的 nonce（用于钱包登录）
router.post('/nonce', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({ error: '请提供钱包地址' });
    }
    
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ error: '无效的钱包地址格式' });
    }
    
    const nonce = await WalletModel.generateNonce(walletAddress);
    
    const message = `欢迎来到德州扑克！\n\n请签名以验证您的身份。\n\nNonce: ${nonce}\n\n此签名不会消耗任何 Gas 费用。`;
    
    res.json({ message, nonce });
    
  } catch (error) {
    logger.error('wallet.get_nonce_failed', { error });
    res.status(500).json({ error: '获取 nonce 失败' });
  }
});

// 钱包签名登录
router.post('/login', async (req, res) => {
  try {
    const { walletAddress, signature, message } = req.body;
    
    if (!walletAddress || !signature || !message) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    
    const { ethers } = await import('ethers');
    const recoveredAddress = ethers.verifyMessage(message, signature);
    
    if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return res.status(401).json({ error: '签名验证失败' });
    }
    
    const nonceMatch = message.match(/Nonce: ([a-fA-F0-9]+)/);
    if (!nonceMatch) {
      return res.status(400).json({ error: '无效的签名消息' });
    }
    
    const storedNonce = await WalletModel.getNonce(walletAddress);
    if (storedNonce !== nonceMatch[1]) {
      return res.status(401).json({ error: 'Nonce 已过期，请重新获取' });
    }
    
    const user = await WalletModel.createOrLoginUser(walletAddress);
    
    const token = generateJWT({
      id: user.id || user.user_id,
      username: user.username,
      walletAddress: walletAddress
    });
    
    res.json({
      token,
      user: {
        id: user.id || user.user_id,
        username: user.username,
        chips: user.chips_balance,
        walletAddress: walletAddress
      }
    });
    
  } catch (error) {
    logger.error('wallet.login_failed', { error });
    res.status(500).json({ error: error.message || '登录失败' });
  }
});

// ==================== 钱包绑定 API ====================

// 获取绑定 nonce（需要登录）
router.post('/bind/nonce', authMiddleware, async (req, res) => {
  try {
    const { address } = req.body;
    const userId = req.user.id;
    
    if (!address) {
      return res.status(400).json({ error: '请提供钱包地址' });
    }
    
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: '无效的钱包地址格式' });
    }
    
    // 检查地址是否已被其他用户绑定
    const existingWallet = await WalletModel.findByAddress(address);
    if (existingWallet && existingWallet.user_id !== userId) {
      return res.status(400).json({ error: '该地址已被其他账户绑定' });
    }
    
    // 生成 nonce
    const nonce = '0x' + crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + NONCE_EXPIRE_SECONDS * 1000);
    
    // 存储 nonce
    await WalletModel.storeBindNonce(userId, address, nonce, expiresAt);
    
    const message = `请使用钱包签名此消息以完成绑定\n\n钱包地址: ${address}\nNonce: ${nonce}\n\n此签名不会消耗任何 Gas 费用。`;
    
    res.json({
      nonce,
      message,
      expiresIn: NONCE_EXPIRE_SECONDS
    });
    
  } catch (error) {
    logger.error('wallet.bind_nonce_failed', { userId: req.user.id, error });
    res.status(500).json({ error: '获取绑定 nonce 失败' });
  }
});

// 验证并绑定钱包
router.post('/bind/verify', authMiddleware, async (req, res) => {
  try {
    const { address, signature, walletType = 'metamask' } = req.body;
    const userId = req.user.id;
    
    if (!address || !signature) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    
    // 验证签名
    const { ethers } = await import('ethers');
    
    // 获取存储的 nonce
    const nonceData = await WalletModel.getBindNonce(userId, address);
    if (!nonceData) {
      return res.status(400).json({ error: '请先获取绑定 nonce' });
    }
    
    if (new Date() > new Date(nonceData.expires_at)) {
      return res.status(400).json({ error: 'Nonce 已过期，请重新获取' });
    }
    
    if (nonceData.used) {
      return res.status(400).json({ error: 'Nonce 已被使用' });
    }
    
    const message = `请使用钱包签名此消息以完成绑定\n\n钱包地址: ${address}\nNonce: ${nonceData.nonce}\n\n此签名不会消耗任何 Gas 费用。`;
    
    const recoveredAddress = ethers.verifyMessage(message, signature);
    
    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({ error: '签名验证失败' });
    }
    
    // 检查地址是否已被其他用户绑定
    const existingWallet = await WalletModel.findByAddress(address);
    if (existingWallet && existingWallet.user_id !== userId) {
      return res.status(400).json({ error: '该地址已被其他账户绑定' });
    }
    
    // 绑定钱包
    await WalletModel.verifyAndBind(userId, address, walletType);
    
    // 标记 nonce 已使用
    await WalletModel.markBindNonceUsed(nonceData.id);
    
    res.json({
      success: true,
      wallet: {
        address: address.toLowerCase(),
        walletType,
        boundAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('wallet.bind_verify_failed', { userId: req.user.id, error });
    res.status(500).json({ error: error.message || '绑定失败' });
  }
});

// 查询绑定状态
router.get('/bind/status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const wallet = await WalletModel.findByUserId(userId);
    
    if (!wallet) {
      return res.json({
        isBound: false,
        wallet: null
      });
    }
    
    const shortAddress = `${wallet.wallet_address.slice(0, 6)}...${wallet.wallet_address.slice(-4)}`;
    
    res.json({
      isBound: true,
      wallet: {
        address: wallet.wallet_address,
        walletType: wallet.wallet_type,
        boundAt: wallet.created_at,
        shortAddress
      }
    });
    
  } catch (error) {
    console.error('Get bind status error:', error);
    res.status(500).json({ error: '获取绑定状态失败' });
  }
});

// 更换绑定地址
router.post('/bind/change', authMiddleware, async (req, res) => {
  try {
    const { newAddress, signature } = req.body;
    const userId = req.user.id;
    
    if (!newAddress || !signature) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    
    if (!/^0x[a-fA-F0-9]{40}$/.test(newAddress)) {
      return res.status(400).json({ error: '无效的钱包地址格式' });
    }
    
    // 获取存储的 nonce
    const nonceData = await WalletModel.getBindNonce(userId, newAddress);
    if (!nonceData) {
      return res.status(400).json({ error: '请先获取绑定 nonce' });
    }
    
    if (new Date() > new Date(nonceData.expires_at)) {
      return res.status(400).json({ error: 'Nonce 已过期，请重新获取' });
    }
    
    // 验证签名
    const { ethers } = await import('ethers');
    const message = `请使用钱包签名此消息以完成绑定\n\n钱包地址: ${newAddress}\nNonce: ${nonceData.nonce}\n\n此签名不会消耗任何 Gas 费用。`;
    
    const recoveredAddress = ethers.verifyMessage(message, signature);
    
    if (recoveredAddress.toLowerCase() !== newAddress.toLowerCase()) {
      return res.status(401).json({ error: '签名验证失败' });
    }
    
    // 检查新地址是否已被其他用户绑定
    const existingWallet = await WalletModel.findByAddress(newAddress);
    if (existingWallet && existingWallet.user_id !== userId) {
      return res.status(400).json({ error: '该地址已被其他账户绑定' });
    }
    
    // 更换绑定
    await WalletModel.changeWallet(userId, newAddress);
    
    // 标记 nonce 已使用
    await WalletModel.markBindNonceUsed(nonceData.id);
    
    res.json({
      success: true,
      wallet: {
        address: newAddress.toLowerCase(),
        boundAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Change wallet error:', error);
    res.status(500).json({ error: error.message || '更换绑定失败' });
  }
});

// 获取用户钱包信息
router.get('/my-wallet', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const wallet = await WalletModel.findByUserId(userId);
    
    res.json({
      walletAddress: wallet?.wallet_address || null,
      walletType: wallet?.wallet_type || null
    });
    
  } catch (error) {
    console.error('Get wallet error:', error);
    res.status(500).json({ error: '获取钱包信息失败' });
  }
});

// 旧版绑定接口（保持兼容）
router.post('/bind', authMiddleware, async (req, res) => {
  try {
    const { walletAddress, signature, message } = req.body;
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: '请先登录' });
    }
    
    if (!walletAddress || !signature || !message) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    
    const { ethers } = await import('ethers');
    const recoveredAddress = ethers.verifyMessage(message, signature);
    
    if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return res.status(401).json({ error: '签名验证失败' });
    }
    
    await WalletModel.verifyAndBind(userId, walletAddress);
    
    res.json({
      success: true,
      message: '钱包绑定成功',
      walletAddress
    });
    
  } catch (error) {
    console.error('Bind wallet error:', error);
    res.status(500).json({ error: error.message || '绑定失败' });
  }
});

module.exports = router;
