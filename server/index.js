// ============================================================
// Texas Hold'em Poker - Server Entry Point
// ============================================================

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const gameRoutes = require('./routes/game');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth').route);
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/recharge', require('./routes/recharge'));
app.use('/api/leaderboard', require('./routes/leaderboard'));
app.use('/api/keys', require('./routes/apiKeys').router);
app.use('/api', gameRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

const http = require('http');
const server = http.createServer(app);

// Mount Socket.IO
const configureSockets = require('./socket');
const io = configureSockets(server);

// Initialize Database and Start Server
async function startServer() {
  try {
    // 初始化数据库
    const { initializeDatabase } = require('./db/schema');
    await initializeDatabase();
    
    // 连接 Redis (可选)
    try {
      const { connectRedis } = require('./cache/redis');
      await connectRedis();
    } catch (redisError) {
      console.log('⚠️ Redis not available, using in-memory cache');
    }
    
    // 启动订单验证服务
    try {
      const orderVerifier = require('./services/orderVerifier');
      await orderVerifier.initialize();
      orderVerifier.start();
      console.log('✅ Order verifier started');
    } catch (verifierError) {
      console.log('⚠️ Order verifier not started:', verifierError.message);
    }
    
    server.listen(PORT, () => {
      console.log(`🃏 Texas Hold'em Server & WebSocket running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
