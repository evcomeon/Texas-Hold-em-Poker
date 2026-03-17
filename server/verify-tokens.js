require('dotenv').config();
const jwt = require('jsonwebtoken');

const tokens = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJ0ZXN0dXNlciIsImlhdCI6MTc3MzYzODAwOCwiZXhwIjoxODA1MTc0MDA4fQ.YUxOTs0h9wdqV-3ndpRi_Flogzi180zTNOd76I-q4Rw',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MiwidXNlcm5hbWUiOiJHdWVzdFBsYXllciIsImlhdCI6MTc3MzYzODAwOCwiZXhwIjoxODA1MTc0MDA4fQ.z9-7nch__DMTEnI9h2KXwNdBR4c-vcKcwIou-nWNlDQ',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MywidXNlcm5hbWUiOiJldiIsImlhdCI6MTc3MzYzODAwOCwiZXhwIjoxODA1MTc0MDA4fQ.IevQ17WMBb1wJiMB8wBhCjaIFk-s9crOF1bZPoG3y2I',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NCwidXNlcm5hbWUiOiJHdWVzdDQzODAiLCJpYXQiOjE3NzM2MzgwMDgsImV4cCI6MTgwNTE3NDAwOH0.RVMbdl3V5zfuaoKUGsdX14u53t75JI3olHqWLR6V3t0',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NSwidXNlcm5hbWUiOiJVc2VyMjMyNyIsImlhdCI6MTc3MzYzODAwOCwiZXhwIjoxODA1MTc0MDA4fQ.oWbCV1JoTGAnNLehrgwYtqAkkLyakLxATMB1-NhTfq0'
];

const secret = process.env.JWT_SECRET;
console.log('JWT_SECRET:', secret);
console.log('');

for (let i = 0; i < tokens.length; i++) {
  try {
    const decoded = jwt.verify(tokens[i], secret);
    console.log('Token', i + 1, 'valid:', decoded.username, '(id:', decoded.id + ')');
  } catch (e) {
    console.log('Token', i + 1, 'invalid:', e.message);
  }
}
