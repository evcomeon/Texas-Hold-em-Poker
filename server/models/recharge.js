const { query, getClient } = require('../db/index');
const crypto = require('crypto');

class RechargeOrder {
  static generateOrderNo() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `RCH${timestamp}${random}`;
  }

  static async create(data) {
    const orderNo = this.generateOrderNo();
    
    const result = await query(
      `INSERT INTO recharge_orders 
       (order_no, user_id, wallet_address, token_symbol, token_amount, chips_amount, to_address, status)
       VALUES ($1, $2, LOWER($3), $4, $5, $6, LOWER($7), 'pending')
       RETURNING *`,
      [
        orderNo,
        data.userId,
        data.walletAddress,
        data.tokenSymbol,
        data.tokenAmount,
        data.chipsAmount,
        data.toAddress
      ]
    );
    
    return result.rows[0];
  }

  static async findById(orderId) {
    const result = await query(
      'SELECT * FROM recharge_orders WHERE id = $1',
      [orderId]
    );
    return result.rows[0];
  }

  static async findByOrderNo(orderNo) {
    const result = await query(
      'SELECT * FROM recharge_orders WHERE order_no = $1',
      [orderNo]
    );
    return result.rows[0];
  }

  static async findByTxHash(txHash) {
    const result = await query(
      'SELECT * FROM recharge_orders WHERE tx_hash = $1',
      [txHash]
    );
    return result.rows[0];
  }

  static async findByUserId(userId, limit = 20, offset = 0) {
    const result = await query(
      `SELECT * FROM recharge_orders 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows;
  }

  static async findPending(limit = 100) {
    const result = await query(
      `SELECT * FROM recharge_orders 
       WHERE status = 'pending' 
       ORDER BY created_at ASC 
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  static async updateTxHash(orderNo, txHash) {
    const result = await query(
      `UPDATE recharge_orders 
       SET tx_hash = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE order_no = $2 
       RETURNING *`,
      [txHash, orderNo]
    );
    return result.rows[0];
  }

  static async confirm(orderNo, txHash) {
    const result = await query(
      `UPDATE recharge_orders 
       SET status = 'confirmed', tx_hash = $1, confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
       WHERE order_no = $2 
       RETURNING *`,
      [txHash, orderNo]
    );
    return result.rows[0];
  }

  static async fail(orderNo, reason) {
    const result = await query(
      `UPDATE recharge_orders 
       SET status = 'failed', fail_reason = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE order_no = $2 
       RETURNING *`,
      [reason, orderNo]
    );
    return result.rows[0];
  }

  static async processOrder(orderNo, txHash, tokenAmount) {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');
      
      // 获取订单并锁定
      const orderResult = await client.query(
        'SELECT * FROM recharge_orders WHERE order_no = $1 FOR UPDATE',
        [orderNo]
      );
      
      if (orderResult.rows.length === 0) {
        throw new Error('订单不存在');
      }
      
      const order = orderResult.rows[0];
      
      if (order.status !== 'pending') {
        throw new Error('订单状态不正确');
      }
      
      // 获取用户并锁定
      const userResult = await client.query(
        'SELECT chips_balance FROM users WHERE id = $1 FOR UPDATE',
        [order.user_id]
      );
      
      if (userResult.rows.length === 0) {
        throw new Error('用户不存在');
      }
      
      const balanceBefore = userResult.rows[0].chips_balance;
      const balanceAfter = balanceBefore + order.chips_amount;
      
      // 更新用户余额
      await client.query(
        'UPDATE users SET chips_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [balanceAfter, order.user_id]
      );
      
      // 记录交易
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, payment_method, payment_id, status)
         VALUES ($1, 'recharge', $2, $3, $4, $5, 'wallet', $6, 'completed')`,
        [order.user_id, order.chips_amount, balanceBefore, balanceAfter, 
         `充值: ${order.token_amount} ${order.token_symbol}`, txHash]
      );
      
      // 更新订单状态
      await client.query(
        `UPDATE recharge_orders 
         SET status = 'completed', tx_hash = $1, confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
         WHERE order_no = $2`,
        [txHash, orderNo]
      );
      
      await client.query('COMMIT');
      
      return {
        success: true,
        orderNo,
        chipsAdded: order.chips_amount,
        balanceBefore,
        balanceAfter
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async getStats(userId = null) {
    let queryStr = `
      SELECT 
        COUNT(*) as total_orders,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_orders,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_orders,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_orders,
        COALESCE(SUM(token_amount) FILTER (WHERE status = 'completed'), 0) as total_token_amount,
        COALESCE(SUM(chips_amount) FILTER (WHERE status = 'completed'), 0) as total_chips_amount
      FROM recharge_orders
    `;
    
    const values = [];
    if (userId) {
      queryStr += ' WHERE user_id = $1';
      values.push(userId);
    }
    
    const result = await query(queryStr, values);
    return result.rows[0];
  }
}

module.exports = RechargeOrder;
