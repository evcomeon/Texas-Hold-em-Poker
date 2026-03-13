// ============================================================
// Texas Hold'em Poker - Auth API Routes
// ============================================================

const express = require('express');
const router = express.Router();
const { verifyGoogleToken, generateJWT } = require('../auth');

// Simple in-memory user database (In production, use MongoDB/Postgres)
const usersDB = new Map();

router.post('/login', async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ error: 'Missing credential' });
  }

  try {
    const payload = await verifyGoogleToken(credential);
    
    // Check if user exists, otherwise create
    let user = usersDB.get(payload.sub);
    if (!user) {
      user = {
        id: payload.sub,
        name: payload.name,
        picture: payload.picture,
        chips: 1000 // Initial bankroll
      };
      usersDB.set(user.id, user);
    } else {
      // Update name/picture just in case
      user.name = payload.name;
      user.picture = payload.picture;
    }

    const token = generateJWT(user);

    res.json({ token, user });
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }
});

router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const { verifyJWT } = require('../auth');
    const decoded = verifyJWT(token);
    const user = usersDB.get(decoded.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ user });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
});

// Helper for socket access
function getUser(id) {
  return usersDB.get(id);
}

function updateUserChips(id, delta) {
  const user = usersDB.get(id);
  if (user) {
    user.chips += delta;
  }
}

module.exports = { route: router, getUser, updateUserChips };
