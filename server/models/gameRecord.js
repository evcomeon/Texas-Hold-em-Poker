// ============================================================
// Game Record Model - 游戏记录数据模型
// ============================================================

const { query, getClient } = require('../db/index');

class GameRecordModel {
  // 创建游戏记录
  static async create({ roomId, stakeLevel, smallBlind, bigBlind, handNumber, communityCards, pot }) {
    const result = await query(
      `INSERT INTO game_records (room_id, stake_level, small_blind, big_blind, hand_number, community_cards, pot)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [roomId, stakeLevel, smallBlind, bigBlind, handNumber, communityCards, pot]
    );
    return result.rows[0];
  }

  // 添加参与者
  static async addParticipant({ gameRecordId, userId, playerName, holeCards, finalHand, betAmount, wonAmount, isWinner, position }) {
    const result = await query(
      `INSERT INTO game_participants 
       (game_record_id, user_id, player_name, hole_cards, final_hand, bet_amount, won_amount, is_winner, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [gameRecordId, userId, playerName, holeCards, finalHand, betAmount, wonAmount, isWinner, position]
    );
    return result.rows[0];
  }

  // 批量保存游戏结果（事务）
  static async saveGameResults({ roomId, stakeLevel, smallBlind, bigBlind, handNumber, communityCards, pot, participants }) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 创建游戏记录
      const gameResult = await client.query(
        `INSERT INTO game_records (room_id, stake_level, small_blind, big_blind, hand_number, community_cards, pot)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [roomId, stakeLevel, smallBlind, bigBlind, handNumber, communityCards, pot]
      );
      const gameRecordId = gameResult.rows[0].id;

      // 添加参与者
      for (const p of participants) {
        await client.query(
          `INSERT INTO game_participants 
           (game_record_id, user_id, player_name, hole_cards, final_hand, bet_amount, won_amount, is_winner, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [gameRecordId, p.userId, p.playerName, p.holeCards, p.finalHand, p.betAmount, p.wonAmount, p.isWinner, p.position]
        );

        // 更新用户统计
        if (p.userId) {
          await client.query(
            `UPDATE users 
             SET total_games = total_games + 1,
                 wins = wins + CASE WHEN $2 THEN 1 ELSE 0 END,
                 total_winnings = total_winnings + $3
             WHERE id = $1`,
            [p.userId, p.isWinner, p.wonAmount]
          );
        }
      }

      await client.query('COMMIT');
      return gameResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // 获取用户的游戏历史
  static async getUserHistory(userId, limit = 50) {
    const result = await query(
      `SELECT 
        gr.id, gr.room_id, gr.stake_level, gr.small_blind, gr.big_blind, 
        gr.hand_number, gr.community_cards, gr.pot, gr.created_at,
        gp.player_name, gp.hole_cards, gp.final_hand, gp.bet_amount, gp.won_amount, gp.is_winner
       FROM game_participants gp
       JOIN game_records gr ON gp.game_record_id = gr.id
       WHERE gp.user_id = $1
       ORDER BY gr.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }

  // 获取房间游戏历史
  static async getRoomHistory(roomId, limit = 50) {
    const result = await query(
      `SELECT 
        gr.id, gr.room_id, gr.stake_level, gr.small_blind, gr.big_blind,
        gr.hand_number, gr.community_cards, gr.pot, gr.created_at
       FROM game_records gr
       WHERE gr.room_id = $1
       ORDER BY gr.created_at DESC
       LIMIT $2`,
      [roomId, limit]
    );
    return result.rows;
  }

  // 获取游戏详情（包含所有参与者）
  static async getGameDetail(gameRecordId) {
    const gameResult = await query(
      'SELECT * FROM game_records WHERE id = $1',
      [gameRecordId]
    );
    if (gameResult.rows.length === 0) return null;

    const participantsResult = await query(
      `SELECT gp.*, u.username, u.avatar_url
       FROM game_participants gp
       LEFT JOIN users u ON gp.user_id = u.id
       WHERE gp.game_record_id = $1
       ORDER BY gp.position`,
      [gameRecordId]
    );

    return {
      ...gameResult.rows[0],
      participants: participantsResult.rows
    };
  }

  // 获取用户统计
  static async getUserGameStats(userId) {
    const result = await query(
      `SELECT 
        COUNT(*) as total_games,
        SUM(CASE WHEN is_winner THEN 1 ELSE 0 END) as wins,
        SUM(won_amount) as total_winnings,
        SUM(bet_amount) as total_bet,
        AVG(bet_amount) as avg_bet
       FROM game_participants
       WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0];
  }
}

module.exports = GameRecordModel;
