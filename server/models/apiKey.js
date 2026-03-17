const { query, getClient } = require('../db/index');
const crypto = require('crypto');

const KEY_PREFIX = 'pk_';
const KEY_LENGTH = 32;

class ApiKeyModel {
  static generateKey() {
    const key = crypto.randomBytes(KEY_LENGTH).toString('hex');
    return KEY_PREFIX + key;
  }

  static hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  static async create(userId, name, description = null, permissions = ['read'], rateLimit = 100, expiresInDays = null) {
    const rawKey = this.generateKey();
    const keyHash = this.hashKey(rawKey);
    const keyPrefix = rawKey.substring(0, 8);
    
    let expiresAt = null;
    if (expiresInDays) {
      expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    }

    const result = await query(
      `INSERT INTO api_keys (user_id, key_hash, key_prefix, name, description, permissions, rate_limit, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, description, permissions, rate_limit, is_active, expires_at, created_at`,
      [userId, keyHash, keyPrefix, name, description, JSON.stringify(permissions), rateLimit, expiresAt]
    );

    return {
      ...result.rows[0],
      key: rawKey
    };
  }

  static async findByKey(key) {
    const keyHash = this.hashKey(key);
    const result = await query(
      `SELECT ak.*, u.username, u.chips_balance, u.is_banned
       FROM api_keys ak
       JOIN users u ON ak.user_id = u.id
       WHERE ak.key_hash = $1 AND ak.is_active = TRUE`,
      [keyHash]
    );
    return result.rows[0];
  }

  static async findByUserId(userId) {
    const result = await query(
      `SELECT id, key_prefix, name, description, permissions, rate_limit, is_active, last_used_at, expires_at, created_at
       FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  static async findById(keyId, userId) {
    const result = await query(
      `SELECT id, key_prefix, name, description, permissions, rate_limit, is_active, last_used_at, expires_at, created_at
       FROM api_keys WHERE id = $1 AND user_id = $2`,
      [keyId, userId]
    );
    return result.rows[0];
  }

  static async updateLastUsed(keyId) {
    await query(
      'UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
      [keyId]
    );
  }

  static async deactivate(keyId, userId) {
    const result = await query(
      'UPDATE api_keys SET is_active = FALSE WHERE id = $1 AND user_id = $2 RETURNING *',
      [keyId, userId]
    );
    return result.rows[0];
  }

  static async delete(keyId, userId) {
    const result = await query(
      'DELETE FROM api_keys WHERE id = $1 AND user_id = $2 RETURNING *',
      [keyId, userId]
    );
    return result.rows[0];
  }

  static async validateKey(key) {
    if (!key || !key.startsWith(KEY_PREFIX)) {
      return { valid: false, error: 'Invalid key format' };
    }

    const keyData = await this.findByKey(key);
    
    if (!keyData) {
      return { valid: false, error: 'API key not found or inactive' };
    }

    if (keyData.is_banned) {
      return { valid: false, error: 'User is banned' };
    }

    if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
      return { valid: false, error: 'API key has expired' };
    }

    await this.updateLastUsed(keyData.id);

    return {
      valid: true,
      keyData: {
        id: keyData.id,
        userId: keyData.user_id,
        username: keyData.username,
        permissions: keyData.permissions,
        rateLimit: keyData.rate_limit
      }
    };
  }
}

module.exports = ApiKeyModel;
