// ============================================================
// Texas Hold'em Poker - API Routes
// ============================================================

const express = require('express');
const router = express.Router();
const GameEngine = require('../game/engine');
const config = require('../config');

const game = new GameEngine(config.game);

function normalizePlayers(body = {}) {
  if (Array.isArray(body.players) && body.players.length >= 2) {
    return body.players;
  }

  if (body.playerName) {
    const defaultChips = config.game.defaultStartingChips;
    return [
      { id: 'player-1', name: body.playerName, chips: defaultChips },
      { id: 'player-2', name: body.opponentName || '对手', chips: defaultChips },
    ];
  }

  return null;
}

function resolveViewerUserId(req) {
  return req.query.viewerUserId || req.body?.viewerUserId || game.players[0]?.id || null;
}

// Create a new game
router.post('/game/new', (req, res) => {
  const players = normalizePlayers(req.body || {});
  if (!players) {
    return res.status(400).json({ error: '请提供至少 2 名玩家，或提供 playerName 让接口创建默认双人局' });
  }

  game.createGame(players);
  res.json(game.getState(players[0].id));
});

// Get current game state
router.get('/game/state', (req, res) => {
  res.json(game.getState(resolveViewerUserId(req)));
});

// Perform player action
router.post('/game/action', (req, res) => {
  const { action, amount, userId } = req.body || {};
  if (!action) {
    return res.status(400).json({ error: '请提供操作类型' });
  }

  const actingUserId = userId || game.players[game.currentPlayerIndex]?.id;
  if (!actingUserId) {
    return res.status(400).json({ error: '当前没有可行动玩家，请先创建牌局' });
  }

  const state = game.performAction(actingUserId, action, amount || 0);
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
