// ============================================================
// User Model - 用户数据模型
// FIX: 添加幂等性支持、乐观锁和分布式锁，防止并发竞争条件
// ============================================================

const { query, getClient } = require('../db/index');

// 内存中的简单锁映射（生产环境应使用Redis分布式锁）
const userLocks = new Map();

class UserModel {
  static async create({ googleId, username, email, password, avatarUrl, isGuest = false }) {
    const result = await query(
      `INSERT INTO users (google_id, username, email, password, avatar_url, chips_balance, is_guest)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [googleId, username, email, password, avatarUrl, 10000, isGuest]
    );
    return result.rows[0];
  }

  static async findById(userId) {
    const result = await query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
    return result.rows[0];
  }

  static async findByGoogleId(googleId) {
    const result = await query(
      'SELECT * FROM users WHERE google_id = $1',
      [googleId]
    );
    return result.rows[0];
  }

  static async findByUsername(username) {
    const result = await query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
    return result.rows[0];
  }

  static async findByEmail(email) {
    const result = await query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    return result.rows[0];
  }

  static async update(userId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = ['username', 'email', 'avatar_url', 'chips_balance', 'level', 'experience', 'password'];
    
    for (const [key, value] of Object.entries(updates)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowedFields.includes(dbKey)) {
        fields.push(`${dbKey} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    }

    if (fields.length === 0) return null;

    values.push(userId);
    const result = await query(
      `UPDATE users SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $${paramCount} 
       RETURNING *`,
      values
    );
    return result.rows[0];
  }

  static async updateLastLogin(userId) {
    await query(
      'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
      [userId]
    );
  }

  static async updateChips(userId, chips) {
    const result = await query(
      'UPDATE users SET chips_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [chips, userId]
    );
    return result.rows[0];
  }

  /**
   * FIX: 增强的余额更新方法，支持幂等性和分布式锁
   * @param {string} userId - 用户ID
   * @param {number} amount - 变动金额（正数为增加，负数为减少）
   * @param {string} description - 描述
   * @param {string} type - 交易类型
   * @param {string} idempotencyKey - 幂等性键（用于防止重复处理）
   * @returns {Promise<{balanceBefore: number, balanceAfter: number, transactionId: number}>}
   */
  static async updateBalance(userId, amount, description = null, type = 'game', idempotencyKey = null) {
    // 如果有幂等性键，先检查是否已处理
    if (idempotencyKey) {
      const existingTx = await this.findTransactionByIdempotencyKey(idempotencyKey);
      if (existingTx) {
        console.log(`[UserModel] Idempotency key already processed: ${idempotencyKey}`);
        return {
          balanceBefore: existingTx.balance_before,
          balanceAfter: existingTx.balance_after,
          transactionId: existingTx.id,
          cached: true
        };
      }
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 使用 FOR UPDATE 锁定用户行
      const userResult = await client.query(
        'SELECT id, chips_balance FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      
      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }

      const balanceBefore = userResult.rows[0].chips_balance;
      const balanceAfter = balanceBefore + amount;

      if (balanceAfter < 0) {
        throw new Error('Insufficient balance');
      }

      // 更新用户余额
      await client.query(
        'UPDATE users SET chips_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [balanceAfter, userId]
      );

      // 插入交易记录，包含幂等性键
      const txResult = await client.query(
        `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id, balance_before, balance_after`,
        [userId, type, amount, balanceBefore, balanceAfter, description, idempotencyKey]
      );

      // 如果因冲突没有插入（幂等性），查询已存在的记录
      let transactionId;
      if (txResult.rows.length === 0 && idempotencyKey) {
        const existingResult = await client.query(
          'SELECT id, balance_before, balance_after FROM transactions WHERE idempotency_key = $1',
          [idempotencyKey]
        );
        if (existingResult.rows.length > 0) {
          transactionId = existingResult.rows[0].id;
          await client.query('COMMIT');
          return {
            balanceBefore: existingResult.rows[0].balance_before,
            balanceAfter: existingResult.rows[0].balance_after,
            transactionId,
            cached: true
          };
        }
        throw new Error('Transaction insert failed unexpectedly');
      }

      transactionId = txResult.rows[0].id;

      await client.query('COMMIT');
      
      return { 
        balanceBefore, 
        balanceAfter, 
        transactionId,
        cached: false
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * FIX: 带客户端连接的余额更新（用于嵌套事务）
   */
  static async updateBalanceWithClient(client, userId, amount, description = null, type = 'game', idempotencyKey = null) {
    // 检查幂等性
    if (idempotencyKey) {
      const checkResult = await client.query(
        'SELECT id, balance_before, balance_after FROM transactions WHERE idempotency_key = $1',
        [idempotencyKey]
      );
      if (checkResult.rows.length > 0) {
        return {
          balanceBefore: checkResult.rows[0].balance_before,
          balanceAfter: checkResult.rows[0].balance_after,
          transactionId: checkResult.rows[0].id,
          cached: true
        };
      }
    }

    // 锁定用户行
    const userResult = await client.query(
      'SELECT chips_balance FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const balanceBefore = userResult.rows[0].chips_balance;
    const balanceAfter = balanceBefore + amount;

    if (balanceAfter < 0) {
      throw new Error('Insufficient balance');
    }

    await client.query(
      'UPDATE users SET chips_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [balanceAfter, userId]
    );

    const txResult = await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [userId, type, amount, balanceBefore, balanceAfter, description, idempotencyKey]
    );

    return {
      balanceBefore,
      balanceAfter,
      transactionId: txResult.rows[0].id,
      cached: false
    };
  }

  /**
   * FIX: 分布式锁获取
   * @param {string} lockKey - 锁的键
   * @param {number} ttlSeconds - 锁的过期时间（秒）
   * @returns {Promise<boolean>} - 是否成功获取锁
   */
  static async acquireLock(lockKey, ttlSeconds = 30) {
    // 简单的内存锁实现（生产环境应使用 Redis）
    if (userLocks.has(lockKey)) {
      const lockData = userLocks.get(lockKey);
      if (lockData.expires > Date.now()) {
        return false;
      }
      // 锁已过期，可以获取
    }
    
    userLocks.set(lockKey, {
      acquired: Date.now(),
      expires: Date.now() + (ttlSeconds * 1000)
    });
    
    return true;
  }

  /**
   * FIX: 释放分布式锁
   */
  static async releaseLock(lockKey) {
    userLocks.delete(lockKey);
  }

  /**
   * FIX: 带锁的余额更新操作
   */
  static async updateBalanceWithLock(userId, amount, description = null, type = 'game', idempotencyKey = null) {
    const lockKey = `balance_update:${userId}`;
    
    const acquired = await this.acquireLock(lockKey, 10);
    if (!acquired) {
      throw new Error('Failed to acquire lock, please try again');
    }

    try {
      return await this.updateBalance(userId, amount, description, type, idempotencyKey);
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  /**
   * FIX: 根据幂等性键查找交易
   */
  static async findTransactionByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) return null;
    
    const result = await query(
      'SELECT id, balance_before, balance_after, created_at FROM transactions WHERE idempotency_key = $1',
      [idempotencyKey]
    );
    return result.rows[0] || null;
  }

  static async updateGameStats(userId, won, amount) {
    const result = await query(
      `UPDATE users 
       SET total_games = total_games + 1,
           wins = wins + CASE WHEN $2 THEN 1 ELSE 0 END,
           total_winnings = total_winnings + $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [userId, won, amount]
    );
    return result.rows[0];
  }

  static async getStats(userId) {
    const result = await query(
      `SELECT 
        id, username, chips_balance, total_games, wins, total_winnings, level, experience,
        CASE WHEN total_games > 0 THEN ROUND((wins::FLOAT / total_games) * 100, 2) ELSE 0 END as win_rate
       FROM users WHERE id = $1`,
      [userId]
    );
    return result.rows[0];
  }

  static async getLeaderboard(limit = 10, type = 'chips') {
    let orderBy = 'chips_balance DESC';
    if (type === 'wins') orderBy = 'wins DESC';
    if (type === 'winnings') orderBy = 'total_winnings DESC';

    const result = await query(
      `SELECT id, username, avatar_url, chips_balance, total_games, wins, total_winnings, level,
              CASE WHEN total_games > 0 THEN ROUND((wins::NUMERIC / total_games) * 100, 2) ELSE 0 END as win_rate
       FROM users 
       WHERE is_banned = FALSE
       ORDER BY ${orderBy}
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  static async delete(userId) {
    await query('DELETE FROM users WHERE id = $1', [userId]);
  }
}

// 定期清理过期的锁
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of userLocks.entries()) {
    if (data.expires < now) {
      userLocks.delete(key);
    }
  }
}, 60000);

module.exports = UserModel;
