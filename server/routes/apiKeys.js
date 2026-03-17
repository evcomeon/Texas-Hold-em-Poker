const express = require('express');
const router = express.Router();
const ApiKeyModel = require('../models/apiKey');
const { verifyJWT } = require('../auth');

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const [type, token] = authHeader.split(' ');
  
  if (type === 'Bearer' && token) {
    try {
      const decoded = verifyJWT(token);
      req.user = { id: decoded.id, username: decoded.username };
      req.authType = 'jwt';
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }
  
  if (type === 'ApiKey' && token) {
    const validation = await ApiKeyModel.validateKey(token);
    if (!validation.valid) {
      return res.status(401).json({ error: validation.error });
    }
    req.user = { id: validation.keyData.userId, username: validation.keyData.username };
    req.apiKey = validation.keyData;
    req.authType = 'apikey';
    return next();
  }

  return res.status(401).json({ error: 'Invalid authorization type. Use Bearer <jwt> or ApiKey <key>' });
};

router.get('/', authMiddleware, async (req, res) => {
  try {
    const keys = await ApiKeyModel.findByUserId(req.user.id);
    res.json({ keys });
  } catch (err) {
    console.error('List API keys error:', err);
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  const { name, description, permissions, rateLimit, expiresInDays } = req.body;

  if (!name || name.length < 2 || name.length > 100) {
    return res.status(400).json({ error: 'Name must be 2-100 characters' });
  }

  try {
    const existingKeys = await ApiKeyModel.findByUserId(req.user.id);
    if (existingKeys.length >= 10) {
      return res.status(400).json({ error: 'Maximum 10 API keys per user' });
    }

    const key = await ApiKeyModel.create(
      req.user.id,
      name,
      description,
      permissions || ['read'],
      rateLimit || 100,
      expiresInDays
    );

    res.status(201).json({
      message: 'API key created. Save the key now - it will not be shown again!',
      key: key.key,
      id: key.id,
      name: key.name,
      permissions: key.permissions,
      expiresAt: key.expires_at
    });
  } catch (err) {
    console.error('Create API key error:', err);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  const keyId = parseInt(req.params.id);
  
  if (isNaN(keyId)) {
    return res.status(400).json({ error: 'Invalid key ID' });
  }

  try {
    const deleted = await ApiKeyModel.delete(keyId, req.user.id);
    if (!deleted) {
      return res.status(404).json({ error: 'API key not found' });
    }
    res.json({ message: 'API key deleted' });
  } catch (err) {
    console.error('Delete API key error:', err);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

router.post('/:id/deactivate', authMiddleware, async (req, res) => {
  const keyId = parseInt(req.params.id);
  
  if (isNaN(keyId)) {
    return res.status(400).json({ error: 'Invalid key ID' });
  }

  try {
    const deactivated = await ApiKeyModel.deactivate(keyId, req.user.id);
    if (!deactivated) {
      return res.status(404).json({ error: 'API key not found' });
    }
    res.json({ message: 'API key deactivated' });
  } catch (err) {
    console.error('Deactivate API key error:', err);
    res.status(500).json({ error: 'Failed to deactivate API key' });
  }
});

module.exports = { router, authMiddleware };
