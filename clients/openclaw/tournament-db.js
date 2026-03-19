import { Pool } from 'pg';
import { getDbConfig } from './config.js';

const pool = new Pool({
  ...getDbConfig(),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function getClient() {
  return pool.connect();
}

async function initTournamentSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      total_players INTEGER NOT NULL,
      buy_in_chips INTEGER NOT NULL DEFAULT 10000,
      winner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMP,
      ended_at TIMESTAMP
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS tournament_rounds (
      id SERIAL PRIMARY KEY,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      round_number INTEGER NOT NULL,
      round_name VARCHAR(80) NOT NULL,
      table_size INTEGER NOT NULL,
      advance_count INTEGER NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMP,
      ended_at TIMESTAMP,
      UNIQUE (tournament_id, round_number)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS tournament_players (
      id SERIAL PRIMARY KEY,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username VARCHAR(50) NOT NULL,
      seed INTEGER NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'registered',
      eliminated_round INTEGER,
      final_position INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tournament_id, user_id)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS tournament_tables (
      id SERIAL PRIMARY KEY,
      round_id INTEGER NOT NULL REFERENCES tournament_rounds(id) ON DELETE CASCADE,
      table_no INTEGER NOT NULL,
      room_id VARCHAR(120),
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMP,
      ended_at TIMESTAMP,
      UNIQUE (round_id, table_no)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS tournament_table_players (
      id SERIAL PRIMARY KEY,
      table_id INTEGER NOT NULL REFERENCES tournament_tables(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username VARCHAR(50) NOT NULL,
      seat_no INTEGER,
      starting_chips INTEGER NOT NULL DEFAULT 10000,
      qualified BOOLEAN DEFAULT FALSE,
      finishing_position INTEGER,
      busted_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (table_id, user_id)
    );
  `);
}

async function createTournament({ name, totalPlayers, buyInChips }) {
  const result = await query(
    `INSERT INTO tournaments (name, total_players, buy_in_chips, status, started_at)
     VALUES ($1, $2, $3, 'running', CURRENT_TIMESTAMP)
     RETURNING *`,
    [name, totalPlayers, buyInChips]
  );

  return result.rows[0];
}

async function createRound({ tournamentId, roundNumber, roundName, tableSize, advanceCount }) {
  const result = await query(
    `INSERT INTO tournament_rounds
     (tournament_id, round_number, round_name, table_size, advance_count, status, started_at)
     VALUES ($1, $2, $3, $4, $5, 'running', CURRENT_TIMESTAMP)
     RETURNING *`,
    [tournamentId, roundNumber, roundName, tableSize, advanceCount]
  );

  return result.rows[0];
}

async function completeRound(roundId) {
  await query(
    `UPDATE tournament_rounds
     SET status = 'completed', ended_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [roundId]
  );
}

async function registerPlayers(tournamentId, players) {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    for (const player of players) {
      await client.query(
        `INSERT INTO tournament_players (tournament_id, user_id, username, seed)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tournament_id, user_id) DO UPDATE
         SET username = EXCLUDED.username,
             seed = EXCLUDED.seed`,
        [tournamentId, player.id, player.username, player.seed]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createTable(roundId, tableNo, players, startingChips) {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    const tableResult = await client.query(
      `INSERT INTO tournament_tables (round_id, table_no, status, started_at)
       VALUES ($1, $2, 'running', CURRENT_TIMESTAMP)
       RETURNING *`,
      [roundId, tableNo]
    );

    const table = tableResult.rows[0];

    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      await client.query(
        `INSERT INTO tournament_table_players (table_id, user_id, username, seat_no, starting_chips)
         VALUES ($1, $2, $3, $4, $5)`,
        [table.id, player.id, player.username, i + 1, startingChips]
      );
    }

    await client.query('COMMIT');
    return table;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function attachRoomId(tableId, roomId) {
  await query(
    `UPDATE tournament_tables
     SET room_id = $2
     WHERE id = $1`,
    [tableId, roomId]
  );
}

async function finalizeTable(tableId, qualifiers, eliminatedUserIds) {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    for (let index = 0; index < qualifiers.length; index++) {
      const qualifier = qualifiers[index];
      await client.query(
        `UPDATE tournament_table_players
         SET qualified = TRUE,
             finishing_position = $3
         WHERE table_id = $1 AND user_id = $2`,
        [tableId, qualifier, index + 1]
      );
    }

    for (const userId of eliminatedUserIds) {
      await client.query(
        `UPDATE tournament_table_players
         SET qualified = FALSE,
             busted_at = CURRENT_TIMESTAMP
         WHERE table_id = $1 AND user_id = $2`,
        [tableId, userId]
      );
    }

    await client.query(
      `UPDATE tournament_tables
       SET status = 'completed', ended_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [tableId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function markRoundResults(tournamentId, roundNumber, qualifiers, eliminatedPlayers) {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    for (const userId of qualifiers) {
      await client.query(
        `UPDATE tournament_players
         SET status = 'qualified'
         WHERE tournament_id = $1 AND user_id = $2`,
        [tournamentId, userId]
      );
    }

    for (const userId of eliminatedPlayers) {
      await client.query(
        `UPDATE tournament_players
         SET status = 'eliminated',
             eliminated_round = $3
         WHERE tournament_id = $1 AND user_id = $2`,
        [tournamentId, userId, roundNumber]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function completeTournament(tournamentId, winnerUserId) {
  await query(
    `UPDATE tournaments
     SET status = 'completed',
         winner_user_id = $2,
         ended_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [tournamentId, winnerUserId]
  );

  await query(
    `UPDATE tournament_players
     SET status = CASE WHEN user_id = $2 THEN 'winner' ELSE status END,
         final_position = CASE WHEN user_id = $2 THEN 1 ELSE final_position END
     WHERE tournament_id = $1`,
    [tournamentId, winnerUserId]
  );
}

async function resetBalances(userIds, chips) {
  await query(
    `UPDATE users
     SET chips_balance = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ANY($1::int[])`,
    [userIds, chips]
  );
}

async function zeroBalancesForPrefix(prefix) {
  await query(
    `UPDATE users
     SET chips_balance = 0,
         updated_at = CURRENT_TIMESTAMP
     WHERE username LIKE $1`,
    [`${prefix}%`]
  );
}

async function closePool() {
  await pool.end();
}

export {
  createRound,
  createTable,
  createTournament,
  completeRound,
  completeTournament,
  attachRoomId,
  finalizeTable,
  initTournamentSchema,
  markRoundResults,
  query,
  registerPlayers,
  resetBalances,
  zeroBalancesForPrefix,
  closePool,
};
