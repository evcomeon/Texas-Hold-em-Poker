const { query, getClient } = require('./database');
const logger = require('../utils/logger');

/**
 * FIX: 增强的充值交易模型
 * - 支持订单号查询
 * - 支持幂等性检查
 * - 支持数据库事务
 */
class RechargeTransaction {
  static async create(data) {
    // FIX: 检查是否已存在相同txHash的记录
    if (data.txHash) {
      const existing = await this.findByTxHash(data.txHash);
      if (existing) {
        logger.info('Transaction already exists', { txHash: data.txHash });
        return existing;
      }
    }

    const result = await query(
      `INSERT INTO recharge_transactions 
       (user_id, order_no, tx_hash, token_symbol, token_amount, chips_amount, from_address, to_address, block_number, confirmations, status, fail_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (tx_hash) DO NOTHING
       RETURNING *`,
      [
        data.userId,
        data.orderNo || null,
        data.txHash,
        data.tokenSymbol,
        data.tokenAmount,
        data.chipsAmount,
        data.fromAddress,
        data.toAddress,
        data.blockNumber,
        data.confirmations || 0,
        data.status || 'pending',
        data.failReason || null
      ]
    );
    
    // 如果因冲突没有插入，查询已存在的记录
    if (!result.rows[0] && data.txHash) {
      return await this.findByTxHash(data.txHash);
    }
    
    logger.info('Created recharge transaction', { 
      txHash: data.txHash, 
      userId: data.userId,
      amount: data.tokenAmount 
    });
    
    return result.rows[0];
  }
  
  static async findByTxHash(txHash) {
    const result = await query(
      'SELECT * FROM recharge_transactions WHERE tx_hash = $1',
      [txHash]
    );
    return result.rows[0];
  }
  
  static async findByOrderNo(orderNo) {
    const result = await query(
      'SELECT * FROM recharge_transactions WHERE order_no = $1',
      [orderNo]
    );
    return result.rows[0];
  }
  
  static async findById(id) {
    const result = await query(
      'SELECT * FROM recharge_transactions WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }
  
  static async findByUserId(userId, limit = 20, offset = 0) {
    const result = await query(
      `SELECT * FROM recharge_transactions 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows;
  }
  
  static async findPending() {
    const result = await query(
      `SELECT * FROM recharge_transactions 
       WHERE status = 'pending' 
       ORDER BY created_at ASC`
    );
    return result.rows;
  }
  
  static async updateStatus(id, status, failReason = null) {
    const fields = ['status = $2', 'updated_at = CURRENT_TIMESTAMP'];
    const values = [id, status];
    let paramIndex = 3;
    
    if (failReason !== null) {
      fields.push(`fail_reason = $${paramIndex}`);
      values.push(failReason);
      paramIndex++;
    }
    
    if (status === 'completed') {
      fields.push('processed_at = CURRENT_TIMESTAMP');
    }
    
    const result = await query(
      `UPDATE recharge_transactions SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );
    
    return result.rows[0];
  }
  
  /**
   * FIX: 通过交易哈希更新状态（幂等性）
   */
  static async updateStatusByTxHash(txHash, status, failReason = null) {
    const fields = ['status = $2', 'updated_at = CURRENT_TIMESTAMP'];
    const values = [txHash, status];
    let paramIndex = 3;
    
    if (failReason !== null) {
      fields.push(`fail_reason = $${paramIndex}`);
      values.push(failReason);
      paramIndex++;
    }
    
    if (status === 'completed') {
      fields.push('processed_at = CURRENT_TIMESTAMP');
    }
    
    const result = await query(
      `UPDATE recharge_transactions SET ${fields.join(', ')} WHERE tx_hash = $1 RETURNING *`,
      values
    );
    
    return result.rows[0];
  }
  
  static async updateConfirmations(txHash, confirmations) {
    const result = await query(
      `UPDATE recharge_transactions 
       SET confirmations = $2, updated_at = CURRENT_TIMESTAMP
       WHERE tx_hash = $1 
       RETURNING *`,
      [txHash, confirmations]
    );
    return result.rows[0];
  }
  
  static async getStats(startDate = null, endDate = null) {
    let queryStr = `
      SELECT 
        COUNT(*) as total_transactions,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_transactions,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_transactions,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_transactions,
        SUM(token_amount) FILTER (WHERE status = 'completed') as total_token_amount,
        SUM(chips_amount) FILTER (WHERE status = 'completed') as total_chips_amount
      FROM recharge_transactions
    `;
    
    const values = [];
    if (startDate && endDate) {
      queryStr += ' WHERE created_at BETWEEN $1 AND $2';
      values.push(startDate, endDate);
    }
    
    const result = await query(queryStr, values);
    return result.rows[0];
  }
  
  /**
   * FIX: 原子性创建或更新充值记录
   */
  static async createOrUpdate(data) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      
      // 尝试查找已存在的记录
      const existing = await client.query(
        'SELECT * FROM recharge_transactions WHERE tx_hash = $1 FOR UPDATE',
        [data.txHash]
      );
      
      if (existing.rows.length > 0) {
        // 已存在，更新状态
        const result = await client.query(
          `UPDATE recharge_transactions 
           SET status = $1, updated_at = CURRENT_TIMESTAMP 
           WHERE tx_hash = $2 
           RETURNING *`,
          [data.status || existing.rows[0].status, data.txHash]
        );
        await client.query('COMMIT');
        return { ...result.rows[0], isNew: false };
      }
      
      // 创建新记录
      const result = await client.query(
        `INSERT INTO recharge_transactions 
         (user_id, order_no, tx_hash, token_symbol, token_amount, chips_amount, from_address, to_address, block_number, confirmations, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          data.userId,
          data.orderNo || null,
          data.txHash,
          data.tokenSymbol,
          data.tokenAmount,
          data.chipsAmount,
          data.fromAddress,
          data.toAddress,
          data.blockNumber,
          data.confirmations || 0,
          data.status || 'pending'
        ]
      );
      
      await client.query('COMMIT');
      return { ...result.rows[0], isNew: true };
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = RechargeTransaction;
