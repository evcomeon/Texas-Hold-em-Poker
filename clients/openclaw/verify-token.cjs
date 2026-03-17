const jwt = require('jsonwebtoken');

const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NzksInVzZXJuYW1lIjoiVGVzdEJvdDEiLCJpYXQiOjE3NzM2MzQ3MTEsImV4cCI6MTgwNTE3MDcxMX0.EURPDhgsSndbQGPvrLjV4FtSB3Jti99T88GlfEuEtRk';
const secret = 'dev-jwt-secret-key-change-in-production';

try {
  const decoded = jwt.verify(token, secret);
  console.log('Token valid:', decoded);
} catch (e) {
  console.log('Token invalid:', e.message);
}
