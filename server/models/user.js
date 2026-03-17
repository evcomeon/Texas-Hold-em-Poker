// ============================================================
// User Model - 用户数据模型
// ============================================================

const { query, getClient } = require('../db/index');

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

  static async updateBalance(userId, amount, description = null, type = 'game') {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const userResult = await client.query('SELECT chips_balance FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }

      const balanceBefore = userResult.rows[0].chips_balance;
      const balanceAfter = balanceBefore + amount;

      if (balanceAfter < 0) {
        throw new Error('Insufficient balance');
      }

      await client.query('UPDATE users SET chips_balance = $1 WHERE id = $2', [balanceAfter, userId]);

      await client.query(
        `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, type, amount, balanceBefore, balanceAfter, description]
      );

      await client.query('COMMIT');
      return { balanceBefore, balanceAfter };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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

module.exports = UserModel;
