const { query, getClient } = require('./database');
const logger = require('../utils/logger');

class UserModel {
  static async findById(userId) {
    const result = await query('SELECT * FROM users WHERE id = $1', [userId]);
    return result.rows[0];
  }
  
  static async findByUsername(username) {
    const result = await query('SELECT * FROM users WHERE username = $1', [username]);
    return result.rows[0];
  }
  
  static async addChips(userId, chipsAmount, txHash, tokenSymbol, tokenAmount) {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');
      
      // Get current balance with lock
      const userResult = await client.query(
        'SELECT chips_balance FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      
      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }
      
      const balanceBefore = userResult.rows[0].chips_balance;
      const balanceAfter = balanceBefore + chipsAmount;
      
      // Update user balance
      await client.query(
        'UPDATE users SET chips_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [balanceAfter, userId]
      );
      
      // Record transaction in main transactions table
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description)
         VALUES ($1, 'recharge', $2, $3, $4, $5)`,
        [userId, chipsAmount, balanceBefore, balanceAfter, `充值: ${tokenAmount} ${tokenSymbol} -> ${chipsAmount} 筹码`]
      );
      
      // Update recharge transaction status
      await client.query(
        `UPDATE recharge_transactions 
         SET status = 'completed', processed_at = CURRENT_TIMESTAMP 
         WHERE tx_hash = $1`,
        [txHash]
      );
      
      await client.query('COMMIT');
      
      logger.info('Recharge completed', {
        userId,
        tokenAmount,
        tokenSymbol,
        chipsAmount,
        balanceBefore,
        balanceAfter
      });
      
      return {
        success: true,
        balanceBefore,
        balanceAfter,
        chipsAdded: chipsAmount
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to add chips', { userId, error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }
  
  static async getBalance(userId) {
    const result = await query('SELECT chips_balance FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.chips_balance || 0;
  }
}

module.exports = UserModel;
