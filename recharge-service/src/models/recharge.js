const { query } = require('./database');
const logger = require('../utils/logger');

class RechargeTransaction {
  static async create(data) {
    const result = await query(
      `INSERT INTO recharge_transactions 
       (user_id, tx_hash, token_symbol, token_amount, chips_amount, from_address, to_address, block_number, confirmations, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        data.userId,
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
  
  static async updateStatus(id, status, confirmations = null) {
    const fields = ['status = $2'];
    const values = [id, status];
    
    if (confirmations !== null) {
      fields.push('confirmations = $3');
      values.push(confirmations);
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
  
  static async updateConfirmations(txHash, confirmations) {
    const result = await query(
      `UPDATE recharge_transactions 
       SET confirmations = $2 
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
}

module.exports = RechargeTransaction;
