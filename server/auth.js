// ============================================================
// Texas Hold'em Poker - Authentication Module
// ============================================================

const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_poker_key_2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '365d';

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
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    return ticket.getPayload();
  } catch (error) {
    console.error('Error verifying Google Token:', error);
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
