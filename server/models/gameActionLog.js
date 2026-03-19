// ============================================================
// Game Action Log Model
// ============================================================

const { query } = require('../db/index');

class GameActionLogModel {
  static async create({
    roomId,
    handNumber = null,
    stakeLevel = null,
    phase = null,
    eventType,
    userId = null,
    playerName = null,
    action = null,
    amount = null,
    pot = null,
    currentBet = null,
    metadata = {},
  }) {
    const result = await query(
      `INSERT INTO game_action_logs
       (room_id, hand_number, stake_level, phase, event_type, user_id, player_name, action, amount, pot, current_bet, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [roomId, handNumber, stakeLevel, phase, eventType, userId, playerName, action, amount, pot, currentBet, metadata]
    );

    return result.rows[0];
  }
}

module.exports = GameActionLogModel;
