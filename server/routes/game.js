// ============================================================
// Texas Hold'em Poker - API Routes
// ============================================================

const express = require('express');
const router = express.Router();
const GameEngine = require('../game/engine');
const config = require('../config');

const game = new GameEngine(config.game);

// Create a new game
router.post('/game/new', (req, res) => {
  const { playerName } = req.body || {};
  const state = game.createGame(playerName || '玩家');
  res.json(state);
});

// Get current game state
router.get('/game/state', (req, res) => {
  res.json(game.getState());
});

// Perform player action
router.post('/game/action', (req, res) => {
  const { action, amount } = req.body;
  if (!action) {
    return res.status(400).json({ error: '请提供操作类型' });
  }
  const state = game.performAction(action, amount || 0);
  if (state.error) {
    return res.status(400).json(state);
  }
  res.json(state);
});

// Start next hand
router.post('/game/next', (req, res) => {
  const state = game.nextHand();
  if (state.error) {
    return res.status(400).json(state);
  }
  res.json(state);
});

// Get game history
router.get('/game/history', (req, res) => {
  res.json(game.getHistory());
});

module.exports = router;
