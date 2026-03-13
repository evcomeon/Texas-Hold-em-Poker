// ============================================================
// Texas Hold'em Poker - Server Entry Point
// ============================================================

const express = require('express');
const cors = require('cors');
const gameRoutes = require('./routes/game');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth').route);
app.use('/api', gameRoutes); // old REST routes (we might not need them much anymore, but keep for compatibility)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

const http = require('http');
const server = http.createServer(app);

// Mount Socket.IO
const configureSockets = require('./socket');
const io = configureSockets(server);

server.listen(PORT, () => {
  console.log(`🃏 Texas Hold'em Server & WebSocket running on http://localhost:${PORT}`);
});
