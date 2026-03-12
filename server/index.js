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
app.use('/api', gameRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🃏 Texas Hold'em Server running on http://localhost:${PORT}`);
});
