// ============================================================
// Texas Hold'em Poker - Authentication Module
// ============================================================

const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('./lib/logger');
const config = require('./config');

const client = new OAuth2Client(config.google.clientId);
const JWT_SECRET = config.jwt.secret;
const JWT_EXPIRES_IN = config.jwt.expiresIn;

async function verifyGoogleToken(token) {
  if (token.startsWith('mock_')) {
    const mockName = token.replace('mock_', '') || 'TestUser';
    return {
      sub: `mock_id_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      name: mockName,
      picture: `https://api.dicebear.com/7.x/avataaars/svg?seed=${mockName}`,
      email: `${mockName.toLowerCase()}@example.com`
    };
  }

  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: config.google.clientId,
    });
    return ticket.getPayload();
  } catch (error) {
    logger.error('auth.google_verify_failed', { error });
    throw new Error('Invalid Google Auth Token');
  }
}

function generateJWT(user) {
  const payload = {
    id: user.id,
    name: user.username || user.name,
    username: user.username || user.name,
    picture: user.avatar_url || user.picture,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyJWT(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    throw new Error('Invalid or expired token');
  }
}

const SALT_LENGTH = 16;
const ITERATIONS = 100000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';

async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, DIGEST, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

async function comparePassword(password, storedHash) {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, DIGEST, (err, derivedKey) => {
      if (err) reject(err);
      resolve(derivedKey.toString('hex') === hash);
    });
  });
}

module.exports = {
  verifyGoogleToken,
  generateJWT,
  verifyJWT,
  hashPassword,
  comparePassword,
};
