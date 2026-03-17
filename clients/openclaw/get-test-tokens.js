import jwt from 'jsonwebtoken';
import pg from 'pg';
import fs from 'fs';

const envContent = fs.readFileSync('.env', 'utf-8');
const envLines = envContent.split('\n');
for (const line of envLines) {
  const [key, value] = line.split('=');
  if (key && value) {
    process.env[key.trim()] = value.trim();
  }
}

const { Pool } = pg;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-key-change-in-production';
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'poker_game',
  user: 'evmbp'
});

async function getOrCreateTestBot(botId) {
  const username = `TestBot${botId}`;
  
  let result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  
  if (result.rows.length === 0) {
    result = await pool.query(
      `INSERT INTO users (username, chips_balance, is_guest) VALUES ($1, 20000, true) RETURNING *`,
      [username]
    );
    console.log(`创建测试机器人: ${username}`);
  }
  
  return result.rows[0];
}

function generateToken(user) {
  return jwt.sign(
    { 
      id: user.id, 
      username: user.username,
      iat: Math.floor(Date.now() / 1000)
    },
    JWT_SECRET,
    { expiresIn: '365d' }
  );
}

async function main() {
  const numBots = parseInt(process.argv[2]) || 5;
  const tokens = [];
  
  for (let i = 1; i <= numBots; i++) {
    const user = await getOrCreateTestBot(i);
    const token = generateToken(user);
    tokens.push({ id: i, username: user.username, token });
  }
  
  console.log('\n=== 测试机器人 Tokens ===\n');
  for (const t of tokens) {
    console.log(`Bot${t.id} (${t.username}):`);
    console.log(`  JWT_TOKEN='${t.token}'`);
    console.log('');
  }
  
  console.log('\n=== JSON 格式 ===\n');
  console.log(JSON.stringify(tokens.map(t => ({ id: t.id, username: t.username, token: t.token }))));
  
  await pool.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
