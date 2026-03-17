const { query, getClient } = require('./database');
const logger = require('../utils/logger');

/**
 * FIX: 增强的用户模型，支持幂等性和嵌套事务
 */
class UserModel {
  static async findById(userId) {
    const result = await query('SELECT * FROM users WHERE id = $1', [userId]);
    return result.rows[0];
  }
  
  static async findByUsername(username) {
    const result = await query('SELECT * FROM users WHERE username = $1', [username]);
    return result.rows[0];
  }
  
  /**
   * FIX: 增强的添加筹码方法，支持幂等性
   * @param {string} userId - 用户ID
   * @param {number} chipsAmount - 筹码数量
   * @param {string} txHash - 交易哈希（用于幂等性）
   * @param {string} tokenSymbol - 代币符号
   * @param {string} tokenAmount - 代币数量
   * @param {string} idempotencyKey - 可选的幂等性键
   */
  static async addChips(userId, chipsAmount, txHash, tokenSymbol, tokenAmount, idempotencyKey = null) {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');
      
      // FIX: 检查是否已处理（幂等性）
      if (idempotencyKey || txHash) {
        const key = idempotencyKey || `recharge:${txHash}`;
        const existingTx = await client.query(
          'SELECT id, balance_before, balance_after FROM transactions WHERE idempotency_key = $1',
          [key]
        );
        
        if (existingTx.rows.length > 0) {
          await client.query('COMMIT');
          logger.info('Recharge already processed (idempotency check)', { 
            userId, 
            txHash,
            idempotencyKey: key 
          });
          return {
            success: true,
            cached: true,
            balanceBefore: existingTx.rows[0].balance_before,
            balanceAfter: existingTx.rows[0].balance_after,
            chipsAdded: chipsAmount
          };
        }
      }
      
      const result = await this.addChipsWithClient(
        client, 
        userId, 
        chipsAmount, 
        txHash, 
        tokenSymbol, 
        tokenAmount,
        idempotencyKey
      );
      
      await client.query('COMMIT');
      return result;
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to add chips', { userId, error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * FIX: 支持外部传入 client 的添加筹码方法（用于嵌套事务）
   * @param {Object} client - 数据库客户端连接
   * @param {string} userId - 用户ID
   * @param {number} chipsAmount - 筹码数量
   * @param {string} txHash - 交易哈希
   * @param {string} tokenSymbol - 代币符号
   * @param {string} tokenAmount - 代币数量
   * @param {string} idempotencyKey - 幂等性键
   */
  static async addChipsWithClient(client, userId, chipsAmount, txHash, tokenSymbol, tokenAmount, idempotencyKey = null) {
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
    
    // FIX: 记录交易时使用幂等性键
    const key = idempotencyKey || (txHash ? `recharge:${txHash}` : null);
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, idempotency_key)
       VALUES ($1, 'recharge', $2, $3, $4, $5, $6)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        userId, 
        chipsAmount, 
        balanceBefore, 
        balanceAfter, 
        `充值: ${tokenAmount} ${tokenSymbol} -> ${chipsAmount} 筹码`,
        key
      ]
    );
    
    // Update recharge transaction status if txHash provided
    if (txHash) {
      await client.query(
        `UPDATE recharge_transactions 
         SET status = 'completed', processed_at = CURRENT_TIMESTAMP 
         WHERE tx_hash = $1`,
        [txHash]
      );
    }
    
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
      cached: false,
      balanceBefore,
      balanceAfter,
      chipsAdded: chipsAmount
    };
  }
  
  static async getBalance(userId) {
    const result = await query('SELECT chips_balance FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.chips_balance || 0;
  }
  
  /**
   * FIX: 通用的 query 方法，供 blockchain.js 使用
   */
  static async query(sql, params) {
    return await query(sql, params);
  }
}

module.exports = UserModel;
