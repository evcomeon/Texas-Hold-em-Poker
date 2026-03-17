const { query, getClient } = require('../db/index');
const crypto = require('crypto');

class WalletModel {
  static async findByAddress(walletAddress) {
    const result = await query(
      `SELECT uw.*, u.* 
       FROM user_wallets uw 
       JOIN users u ON uw.user_id = u.id 
       WHERE LOWER(uw.wallet_address) = LOWER($1)`,
      [walletAddress]
    );
    return result.rows[0];
  }

  static async findByUserId(userId) {
    const result = await query(
      'SELECT * FROM user_wallets WHERE user_id = $1 AND is_primary = TRUE',
      [userId]
    );
    return result.rows[0];
  }

  static async generateNonce(walletAddress) {
    const nonce = crypto.randomBytes(32).toString('hex');
    
    const existing = await query(
      'SELECT * FROM user_wallets WHERE LOWER(wallet_address) = LOWER($1)',
      [walletAddress]
    );
    
    if (existing.rows.length > 0) {
      await query(
        'UPDATE user_wallets SET nonce = $1 WHERE LOWER(wallet_address) = LOWER($2)',
        [nonce, walletAddress]
      );
    } else {
      await query(
        'INSERT INTO user_wallets (wallet_address, nonce) VALUES (LOWER($1), $2)',
        [walletAddress, nonce]
      );
    }
    
    return nonce;
  }

  static async getNonce(walletAddress) {
    const result = await query(
      'SELECT nonce FROM user_wallets WHERE LOWER(wallet_address) = LOWER($1)',
      [walletAddress]
    );
    return result.rows[0]?.nonce;
  }

  static async storeBindNonce(userId, walletAddress, nonce, expiresAt) {
    await query(
      `INSERT INTO wallet_bind_nonces (user_id, wallet_address, nonce, purpose, expires_at)
       VALUES ($1, LOWER($2), $3, 'bind', $4)
       ON CONFLICT (nonce) DO UPDATE SET 
         wallet_address = LOWER($2),
         expires_at = $4,
         used = FALSE`,
      [userId, walletAddress, nonce, expiresAt]
    );
  }

  static async getBindNonce(userId, walletAddress) {
    const result = await query(
      `SELECT * FROM wallet_bind_nonces 
       WHERE user_id = $1 AND LOWER(wallet_address) = LOWER($2) AND used = FALSE
       ORDER BY created_at DESC LIMIT 1`,
      [userId, walletAddress]
    );
    return result.rows[0];
  }

  static async markBindNonceUsed(nonceId) {
    await query(
      'UPDATE wallet_bind_nonces SET used = TRUE WHERE id = $1',
      [nonceId]
    );
  }

  static async changeWallet(userId, newWalletAddress) {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');
      
      // 删除旧钱包绑定
      await client.query(
        'DELETE FROM user_wallets WHERE user_id = $1',
        [userId]
      );
      
      // 绑定新钱包
      await client.query(
        `INSERT INTO user_wallets (user_id, wallet_address, wallet_type, is_primary, last_used_at)
         VALUES ($1, LOWER($2), 'metamask', TRUE, CURRENT_TIMESTAMP)`,
        [userId, newWalletAddress]
      );
      
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async verifyAndBind(userId, walletAddress, walletType = 'metamask') {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');
      
      // 检查钱包是否已绑定其他用户
      const existing = await client.query(
        'SELECT user_id FROM user_wallets WHERE LOWER(wallet_address) = LOWER($1)',
        [walletAddress]
      );
      
      if (existing.rows.length > 0 && existing.rows[0].user_id !== userId) {
        throw new Error('该钱包已被其他用户绑定');
      }
      
      if (existing.rows.length > 0 && existing.rows[0].user_id === userId) {
        // 已绑定，更新最后使用时间
        await client.query(
          'UPDATE user_wallets SET last_used_at = CURRENT_TIMESTAMP WHERE LOWER(wallet_address) = LOWER($1)',
          [walletAddress]
        );
      } else {
        // 检查用户是否已有主钱包
        const userWallet = await client.query(
          'SELECT id FROM user_wallets WHERE user_id = $1 AND is_primary = TRUE',
          [userId]
        );
        
        const isPrimary = userWallet.rows.length === 0;
        
        // 绑定新钱包
        await client.query(
          `INSERT INTO user_wallets (user_id, wallet_address, wallet_type, is_primary, last_used_at)
           VALUES ($1, LOWER($2), $3, $4, CURRENT_TIMESTAMP)
           ON CONFLICT (wallet_address) DO UPDATE SET user_id = $1, last_used_at = CURRENT_TIMESTAMP`,
          [userId, walletAddress, walletType, isPrimary]
        );
      }
      
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async createOrLoginUser(walletAddress, username = null) {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');
      
      // 查找是否已有该钱包绑定的用户
      const existingWallet = await client.query(
        `SELECT uw.user_id, uw.wallet_address, u.* 
         FROM user_wallets uw 
         JOIN users u ON uw.user_id = u.id 
         WHERE LOWER(uw.wallet_address) = LOWER($1)`,
        [walletAddress]
      );
      
      if (existingWallet.rows.length > 0) {
        // 用户已存在，更新登录时间
        await client.query(
          'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
          [existingWallet.rows[0].user_id]
        );
        await client.query(
          'UPDATE user_wallets SET last_used_at = CURRENT_TIMESTAMP WHERE LOWER(wallet_address) = LOWER($1)',
          [walletAddress]
        );
        await client.query('COMMIT');
        return existingWallet.rows[0];
      }
      
      // 创建新用户
      const newUsername = username || `Wallet_${walletAddress.slice(2, 8)}`;
      
      const userResult = await client.query(
        `INSERT INTO users (username, chips_balance, is_guest, last_login_at)
         VALUES ($1, 10000, FALSE, CURRENT_TIMESTAMP)
         RETURNING *`,
        [newUsername]
      );
      
      const newUser = userResult.rows[0];
      
      // 绑定钱包，使用 ON CONFLICT 处理已存在的情况
      await client.query(
        `INSERT INTO user_wallets (user_id, wallet_address, wallet_type, is_primary, last_used_at)
         VALUES ($1, LOWER($2), 'metamask', TRUE, CURRENT_TIMESTAMP)
         ON CONFLICT (wallet_address) DO UPDATE SET user_id = $1, last_used_at = CURRENT_TIMESTAMP`,
        [newUser.id, walletAddress]
      );
      
      await client.query('COMMIT');
      return newUser;
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = WalletModel;
