// ============================================================
// Texas Hold'em Poker - Server Entry Point
// ============================================================

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const logger = require('./lib/logger');
const config = require('./config');

const app = express();
const PORT = config.app.port;

// CORS Configuration
const corsOrigins = process.env.CORS_ORIGINS 
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : '*';

app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth').route);
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/recharge', require('./routes/recharge'));
app.use('/api/leaderboard', require('./routes/leaderboard'));
app.use('/api/keys', require('./routes/apiKeys').router);
app.use('/api', require('./routes/game'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

const http = require('http');
const server = http.createServer(app);

// 可选 Bot 插件：真人 < 3 时自动填充陪玩机器人
let socketOpts = {};
if (config.bots?.enableFillBots) {
  try {
    const botPlugin = require('./bots/fillBot');
    socketOpts = {
      fillBotsProvider: botPlugin.createFillBotsProvider(config.bots),
      getPlayerChips: botPlugin.createGetPlayerChips(),
      onAfterBroadcast: botPlugin.createBotTurnDriver(config.bots),
      shouldSkipChipsSave: botPlugin.createShouldSkipChipsSave(),
    };
    logger.info('bot_plugin.loaded');
  } catch (e) {
    logger.warn('bot_plugin_unavailable', { error: e.message });
  }
}

// Mount Socket.IO
const configureSockets = require('./socket');
const io = configureSockets(server, socketOpts);

// Initialize Database and Start Server
async function startServer() {
  try {
    logger.info('server.starting');
    
    // 初始化数据库
    const { initializeDatabase } = require('./db/schema');
    await initializeDatabase();
    logger.info('db.initialized');
    
    // 连接 Redis (可选，不阻塞)
    setImmediate(async () => {
      try {
        const { connectRedis } = require('./cache/redis');
        await connectRedis();
      } catch (redisError) {
        logger.warn('redis.unavailable', { error: redisError });
      }
    });
    
    // 启动订单验证服务 (异步，不阻塞启动)
    setImmediate(async () => {
      try {
        const orderVerifier = require('./services/orderVerifier');
        await orderVerifier.initialize();
        orderVerifier.start();
        logger.info('order_verifier.started');
      } catch (verifierError) {
        logger.warn('order_verifier.not_started', { error: verifierError });
      }
    });
    
    server.listen(PORT, '0.0.0.0', () => {
      logger.info('server.started', { port: PORT, host: '0.0.0.0' });
    });
  } catch (error) {
    logger.error('server.start_failed', { error });
    process.exit(1);
  }
}

startServer();
