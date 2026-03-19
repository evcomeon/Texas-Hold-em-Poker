import jwt from 'jsonwebtoken';
import { query, initTournamentSchema, closePool } from './tournament-db.js';
import { getEnv } from './config.js';

const ACCOUNT_PREFIX = process.env.ACCOUNT_PREFIX || 'TournamentBot';
const ACCOUNT_COUNT = parseInt(process.env.ACCOUNT_COUNT || '256', 10);
const STARTING_CHIPS = parseInt(process.env.STARTING_CHIPS || '10000', 10);

function buildAccounts(count) {
  return Array.from({ length: count }, (_, index) => {
    const serial = String(index + 1).padStart(3, '0');
    return {
      username: `${ACCOUNT_PREFIX}${serial}`,
      email: `${ACCOUNT_PREFIX.toLowerCase()}${serial}@example.com`,
    };
  });
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      name: user.username,
      username: user.username,
      picture: user.avatar_url || null,
    },
    getEnv('JWT_SECRET', 'dev-jwt-secret-key-change-in-production'),
    { expiresIn: getEnv('JWT_EXPIRES_IN', '7d') }
  );
}

async function ensureAccounts() {
  await initTournamentSchema();

  const accounts = buildAccounts(ACCOUNT_COUNT);

  for (const account of accounts) {
    const existing = await query(
      `SELECT id FROM users WHERE username = $1`,
      [account.username]
    );

    if (existing.rows[0]) {
      await query(
        `UPDATE users
         SET email = $2,
             chips_balance = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [existing.rows[0].id, account.email, STARTING_CHIPS]
      );
    } else {
      await query(
        `INSERT INTO users (username, email, password, chips_balance, is_guest)
         VALUES ($1, $2, NULL, $3, FALSE)`,
        [account.username, account.email, STARTING_CHIPS]
      );
    }
  }

  await query(
    `UPDATE users
     SET chips_balance = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE username LIKE $1`,
    [`${ACCOUNT_PREFIX}%`, STARTING_CHIPS]
  );

  const result = await query(
    `SELECT id, username, email, avatar_url, chips_balance
     FROM users
     WHERE username LIKE $1
     ORDER BY username`,
    [`${ACCOUNT_PREFIX}%`]
  );

  const users = result.rows.map((row) => ({
    ...row,
    token: createToken(row),
  }));

  console.log(`Created or refreshed ${users.length} tournament accounts.`);
  console.log(`Prefix: ${ACCOUNT_PREFIX}`);
  console.log(`Starting chips: ${STARTING_CHIPS}`);
  console.log(`Example account: ${users[0]?.username || 'n/a'}`);
}

ensureAccounts()
  .catch((error) => {
    console.error('Failed to create tournament accounts:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
