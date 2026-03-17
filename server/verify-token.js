require('dotenv').config();
const jwt = require('jsonwebtoken');

const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJ0ZXN0dXNlciIsImlhdCI6MTc3MzYzNzY4NCwiZXhwIjoxODA1MTczNjg0fQ.bVZJxN4ciQJolFDG2TifWUO6ZT2jbEnqKBu8oEl3QKg';
const secret = process.env.JWT_SECRET;

console.log('JWT_SECRET from env:', secret);

try {
  const decoded = jwt.verify(token, secret);
  console.log('Token valid:', decoded);
} catch (e) {
  console.log('Token invalid:', e.message);
}
