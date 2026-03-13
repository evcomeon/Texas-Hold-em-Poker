// ============================================================
// Texas Hold'em Poker - Authentication Module
// ============================================================

const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_poker_key_2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Verify Google OAuth credential token
 * @param {string} token - The credential token from Google Identity Services
 * @returns {object} Payload with user details
 */
async function verifyGoogleToken(token) {
  // Check if it's a mock token for development
  if (token.startsWith('mock_')) {
    const mockName = token.replace('mock_', '') || 'TestUser';
    return {
      sub: `mock_id_${Math.floor(Math.random() * 100000)}`,
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

/**
 * Generate a JWT for a user
 * @param {object} user - User object containing id, name, etc.
 * @returns {string} Signed JWT
 */
function generateJWT(user) {
  return jwt.sign(
    { id: user.id, name: user.name, picture: user.picture },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Verify and decode a JWT
 * @param {string} token
 * @returns {object} Decoded payload
 */
function verifyJWT(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    throw new Error('Invalid or expired token');
  }
}

module.exports = {
  verifyGoogleToken,
  generateJWT,
  verifyJWT
};
