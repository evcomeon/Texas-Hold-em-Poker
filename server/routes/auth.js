// ============================================================
// Texas Hold'em Poker - Auth API Routes
// ============================================================

const express = require('express');
const router = express.Router();
const { verifyGoogleToken, generateJWT, verifyJWT, hashPassword, comparePassword } = require('../auth');
const UserModel = require('../models/user');
const { cacheSession, deleteSession, getSession } = require('../cache/redis');
const logger = require('../lib/logger');

router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: '用户名、邮箱和密码都是必填项' });
  }

  if (username.length < 2 || username.length > 20) {
    return res.status(400).json({ error: '用户名长度必须在2-20个字符之间' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: '密码长度至少6个字符' });
  }

  try {
    const existingUser = await UserModel.findByUsername(username);
    if (existingUser) {
      return res.status(409).json({ error: '用户名已被使用' });
    }

    const hashedPassword = await hashPassword(password);
    
    const user = await UserModel.create({
      username,
      email,
      password: hashedPassword,
    });

    const token = generateJWT(user);
    
    await cacheSession(user.id, { userId: user.id, createdAt: Date.now() });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatar_url,
        chipsBalance: user.chips_balance,
        level: user.level,
        totalGames: user.total_games,
        wins: user.wins,
      }
    });
  } catch (err) {
    logger.error('auth.register_failed', { username, email, error: err });
    if (err.code === '23505') {
      return res.status(409).json({ error: '邮箱已被注册' });
    }
    res.status(500).json({ error: '注册失败，请稍后重试' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' });
  }

  try {
    const user = await UserModel.findByUsername(username);
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    if (!user.password) {
      return res.status(401).json({ error: '该账户使用第三方登录，请使用对应方式登录' });
    }

    const isValid = await comparePassword(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    await UserModel.updateLastLogin(user.id);
    
    const token = generateJWT(user);
    await cacheSession(user.id, { userId: user.id, createdAt: Date.now() });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatar_url,
        chipsBalance: user.chips_balance,
        level: user.level,
        totalGames: user.total_games,
        wins: user.wins,
      }
    });
  } catch (err) {
    logger.error('auth.login_failed', { username, error: err });
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

router.post('/google', async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ error: 'Missing credential' });
  }

  try {
    const payload = await verifyGoogleToken(credential);
    logger.info('auth.google_payload_verified', {
      googleId: payload.sub,
      email: payload.email,
      hasPicture: Boolean(payload.picture),
    });
    
    let user = await UserModel.findByGoogleId(payload.sub);
    
    if (!user) {
      const username = payload.name || payload.given_name || `Player_${payload.sub.slice(-6)}`;
      logger.info('auth.google_creating_user', { googleId: payload.sub, username });
      
      user = await UserModel.create({
        googleId: payload.sub,
        username: username,
        email: payload.email,
        avatarUrl: payload.picture,
      });
    } else {
      await UserModel.update(user.id, {
        avatarUrl: payload.picture,
      });
      await UserModel.updateLastLogin(user.id);
    }

    logger.info('auth.google_login_succeeded', { userId: user.id, username: user.username });

    const token = generateJWT(user);
    await cacheSession(user.id, { userId: user.id, createdAt: Date.now() });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatar_url,
        chipsBalance: user.chips_balance,
        level: user.level,
        totalGames: user.total_games,
        wins: user.wins,
      }
    });
  } catch (err) {
    logger.error('auth.google_failed', { error: err });
    return res.status(401).json({ error: err.message || 'Google登录失败' });
  }
});

router.post('/guest', async (req, res) => {
  const { name } = req.body;
  
  try {
    const guestName = name || `Guest_${Math.floor(Math.random() * 10000)}`;
    
    const user = await UserModel.create({
      username: guestName,
      email: null,
      password: null,
      isGuest: true,
    });

    const token = generateJWT(user);
    await cacheSession(user.id, { userId: user.id, createdAt: Date.now(), isGuest: true });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: null,
        avatarUrl: user.avatar_url,
        chipsBalance: user.chips_balance,
        level: user.level,
        isGuest: true,
      }
    });
  } catch (err) {
    logger.error('auth.guest_failed', { error: err });
    res.status(500).json({ error: '游客登录失败' });
  }
});

router.post('/logout', async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = verifyJWT(token);
      await deleteSession(decoded.id);
    } catch (e) {
      // Ignore errors on logout
    }
  }
  
  res.json({ message: '已退出登录' });
});

router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = verifyJWT(token);
    
    const session = await getSession(decoded.id);
    if (!session) {
      return res.status(401).json({ error: '会话已过期，请重新登录' });
    }
    
    const user = await UserModel.findById(decoded.id);
    
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    
    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatar_url,
        chipsBalance: user.chips_balance,
        level: user.level,
        experience: user.experience,
        totalGames: user.total_games,
        wins: user.wins,
        totalWinnings: user.total_winnings,
        createdAt: user.created_at,
      }
    });
  } catch (err) {
    return res.status(401).json({ error: '无效的Token' });
  }
});

router.post('/refresh', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = verifyJWT(token);
    const user = await UserModel.findById(decoded.id);
    
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    
    const newToken = generateJWT(user);
    await cacheSession(user.id, { userId: user.id, createdAt: Date.now() });
    
    res.json({
      token: newToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatar_url,
        chipsBalance: user.chips_balance,
        level: user.level,
      }
    });
  } catch (err) {
    return res.status(401).json({ error: 'Token刷新失败' });
  }
});

// Wallet login - get nonce
router.post('/wallet/nonce', async (req, res) => {
  const { address } = req.body;
  
  if (!address) {
    return res.status(400).json({ error: '请提供钱包地址' });
  }
  
  try {
    const WalletModel = require('../models/wallet');
    const nonce = await WalletModel.generateNonce(address);
    logger.info('auth.wallet_nonce_generated', { address });
    
    res.json({ nonce });
  } catch (err) {
    logger.error('auth.wallet_nonce_failed', { address, error: err });
    res.status(500).json({ error: '获取nonce失败' });
  }
});

// Wallet login - verify signature
router.post('/wallet/verify', async (req, res) => {
  const { address, signature } = req.body;
  
  if (!address || !signature) {
    return res.status(400).json({ error: '请提供钱包地址和签名' });
  }
  
  try {
    const { ethers } = require('ethers');
    const WalletModel = require('../models/wallet');
    
    // Get stored nonce
    const nonce = await WalletModel.getNonce(address);
    logger.info('auth.wallet_verify_attempt', { address, hasNonce: Boolean(nonce) });
    
    if (!nonce) {
      return res.status(401).json({ error: '请先获取nonce' });
    }
    
    // Verify signature using ethers v6
    // 重要：personal_sign 签名 hex 字符串时，MetaMask 会把它当作 bytes 处理
    // 所以我们需要把 nonce 转换为 bytes array 来验证
    let recoveredAddress;
    try {
      // 将 hex 字符串转换为 bytes array
      const nonceBytes = ethers.getBytes('0x' + nonce);
      recoveredAddress = ethers.verifyMessage(nonceBytes, signature);
    } catch (e) {
      logger.warn('auth.wallet_verify_signature_invalid', { address, error: e });
      return res.status(401).json({ error: '签名格式错误' });
    }
    
    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      logger.warn('auth.wallet_verify_address_mismatch', {
        expectedAddress: address,
        recoveredAddress,
      });
      return res.status(401).json({ 
        error: `签名账户不匹配。请确认 MetaMask 中选中的账户是 ${address}`,
        expectedAddress: address,
        signedAddress: recoveredAddress
      });
    }
    
    // Create or get user
    const user = await WalletModel.createOrLoginUser(address);
    
    const token = generateJWT(user);
    await cacheSession(user.id, { userId: user.id, createdAt: Date.now() });
    
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatar_url,
        chipsBalance: user.chips_balance,
        level: user.level,
        walletAddress: address,
      }
    });
  } catch (err) {
    logger.error('auth.wallet_verify_failed', { address, error: err });
    res.status(500).json({ error: err.message || '钱包登录失败' });
  }
});

async function getUser(id) {
  return await UserModel.findById(id);
}

async function updateUserChips(id, delta) {
  return await UserModel.updateBalance(id, delta);
}

module.exports = { route: router, getUser, updateUserChips };
