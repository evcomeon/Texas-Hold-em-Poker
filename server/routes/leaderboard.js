const express = require('express');
const router = express.Router();
const UserModel = require('../models/user');
const logger = require('../lib/logger');

router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const type = req.query.type || 'chips';
    
    if (!['chips', 'wins', 'winnings', 'winrate'].includes(type)) {
      return res.status(400).json({ error: '无效的排行榜类型' });
    }
    
    const leaderboard = await UserModel.getLeaderboard(limit, type);
    
    const result = leaderboard.map((user, index) => ({
      rank: index + 1,
      id: user.id,
      username: user.username,
      avatarUrl: user.avatar_url,
      chips: user.chips_balance,
      totalGames: user.total_games,
      wins: user.wins,
      winRate: user.win_rate,
      totalWinnings: user.total_winnings,
      level: user.level
    }));
    
    res.json({
      type,
      updatedAt: new Date().toISOString(),
      leaderboard: result
    });
  } catch (err) {
    logger.error('leaderboard.fetch_failed', { type: req.query.type || 'chips', error: err });
    res.status(500).json({ error: '获取排行榜失败' });
  }
});

router.get('/chips', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const leaderboard = await UserModel.getLeaderboard(limit, 'chips');
    
    const result = leaderboard.map((user, index) => ({
      rank: index + 1,
      id: user.id,
      username: user.username,
      avatarUrl: user.avatar_url,
      chips: user.chips_balance,
      totalGames: user.total_games,
      wins: user.wins,
      winRate: user.win_rate,
      level: user.level
    }));
    
    res.json({ type: 'chips', leaderboard: result });
  } catch (err) {
    logger.error('leaderboard.chips_failed', { error: err });
    res.status(500).json({ error: '获取筹码榜失败' });
  }
});

router.get('/winrate', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const { query } = require('../db/index');
    
    const result = await query(`
      SELECT id, username, avatar_url, chips_balance, total_games, wins, level,
             CASE WHEN total_games > 0 THEN ROUND((wins::NUMERIC / total_games) * 100, 2) ELSE 0 END as win_rate
      FROM users 
      WHERE is_banned = FALSE AND total_games >= 10
      ORDER BY win_rate DESC, total_games DESC
      LIMIT $1
    `, [limit]);
    
    const leaderboard = result.rows.map((user, index) => ({
      rank: index + 1,
      id: user.id,
      username: user.username,
      avatarUrl: user.avatar_url,
      totalGames: user.total_games,
      wins: user.wins,
      winRate: user.win_rate,
      chips: user.chips_balance,
      level: user.level
    }));
    
    res.json({ type: 'winrate', leaderboard });
  } catch (err) {
    logger.error('leaderboard.winrate_failed', { error: err });
    res.status(500).json({ error: '获取胜率榜失败' });
  }
});

module.exports = router;
