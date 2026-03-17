const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'poker_game',
  user: 'evmbp'
});

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_poker_key_2026';

async function main() {
  const result = await pool.query(
    "SELECT id, username FROM users WHERE chips_balance > 0 ORDER BY id LIMIT 5"
  );
  
  const tokens = [];
  for (const user of result.rows) {
    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '365d' }
    );
    tokens.push({ id: user.id, username: user.username, token });
  }
  
  console.log('\n=== 测试用 JWT Tokens ===\n');
  for (const t of tokens) {
    console.log(`// ${t.username} (id: ${t.id})`);
    console.log(`'${t.token}',`);
  }
  
  console.log('\n=== JSON ===');
  console.log(JSON.stringify(tokens.map(t => t.token)));
  
  await pool.end();
}

main().catch(console.error);
