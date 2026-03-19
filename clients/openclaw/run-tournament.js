import jwt from 'jsonwebtoken';
import { io } from 'socket.io-client';
import { spawn } from 'child_process';
import {
  attachRoomId,
  closePool,
  completeRound,
  completeTournament,
  createRound,
  createTable,
  createTournament,
  finalizeTable,
  initTournamentSchema,
  markRoundResults,
  query,
  registerPlayers,
  resetBalances,
} from './tournament-db.js';
import { SERVER_DIR, getEnv } from './config.js';

const API_URL = process.env.API_URL || 'http://localhost:3001';
const ACCOUNT_PREFIX = process.env.ACCOUNT_PREFIX || 'TournamentBot';
const PLAYER_COUNT = parseInt(process.env.PLAYER_COUNT || '256', 10);
const STARTING_CHIPS = parseInt(process.env.STARTING_CHIPS || '10000', 10);
const STAKE_LEVEL = process.env.STAKE_LEVEL || 'medium';
const TOURNAMENT_BASE_PORT = parseInt(process.env.TOURNAMENT_BASE_PORT || '4100', 10);

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk(list, size) {
  const chunks = [];
  for (let index = 0; index < list.length; index += size) {
    chunks.push(list.slice(index, index + size));
  }
  return chunks;
}

function getRoundConfig(playerCount) {
  if (playerCount > 4) {
    return {
      tableSize: 8,
      advanceCount: 2,
      roundName: `Top ${playerCount}`,
    };
  }

  return {
    tableSize: playerCount,
    advanceCount: 1,
    roundName: 'Final Table',
  };
}

class TournamentBot {
  constructor(player, apiUrl, stakeLevel) {
    this.player = player;
    this.apiUrl = apiUrl;
    this.stakeLevel = stakeLevel;
    this.socket = null;
    this.roomId = null;
    this.latestState = null;
    this.isSpectator = false;
    this.isReady = false;
    this.pendingTurnKey = null;
    this.actedTurnKey = null;
    this.pendingTimers = new Set();
    this.handlers = {
      roomAssigned: [],
      state: [],
      busted: [],
      disconnected: [],
    };
  }

  on(event, handler) {
    this.handlers[event].push(handler);
  }

  emit(event, payload) {
    for (const handler of this.handlers[event]) {
      handler(payload);
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = io(this.apiUrl, {
        auth: { token: this.player.token },
        transports: ['websocket', 'polling'],
      });

      this.socket.on('connect', () => resolve());
      this.socket.on('connect_error', reject);
      this.socket.on('disconnect', () => this.emit('disconnected', this.player.id));

      this.socket.on('game:start', (data) => {
        this.roomId = data.roomId;
        this.isSpectator = false;
        this.emit('roomAssigned', { playerId: this.player.id, roomId: data.roomId });
      });

      this.socket.on('game:spectator', (data) => {
        this.roomId = data.roomId;
        this.isSpectator = true;
        this.emit('roomAssigned', { playerId: this.player.id, roomId: data.roomId });
      });

      this.socket.on('game:busted', () => {
        this.isSpectator = true;
        this.emit('busted', this.player.id);
      });

      this.socket.on('game:state', (state) => {
        this.latestState = state;
        this.isSpectator = Boolean(state.isSpectator);
        this.handleState(state);
        this.emit('state', { playerId: this.player.id, state });
      });
    });
  }

  joinLobby() {
    this.socket.emit('lobby:join', { stakeLevel: this.stakeLevel });
  }

  getTurnKey(state) {
    if (!state || typeof state.handNumber !== 'number') return null;
    return `${state.handNumber}:${state.phase}:${state.currentPlayerIndex}:${state.currentBet}`;
  }

  isMyTurn(state) {
    if (!state || state.phase === 'WAITING' || state.phase === 'FINISHED' || state.phase === 'SHOWDOWN') {
      return false;
    }

    const me = state.players.find((player) => player.isMe);
    if (!me || me.folded || me.allIn || !me.isActive) return false;

    return me.originalIndex === state.currentPlayerIndex;
  }

  handleState(state) {
    if (this.isMyTurn(state)) {
      const turnKey = this.getTurnKey(state);
      if (turnKey && turnKey !== this.pendingTurnKey && turnKey !== this.actedTurnKey) {
        this.pendingTurnKey = turnKey;
        this.schedule(() => this.makeDecision(turnKey), 200 + Math.random() * 500);
      }
    } else {
      this.pendingTurnKey = null;
    }

    if (state.phase === 'SHOWDOWN' && !this.isSpectator && !this.isReady) {
      this.isReady = true;
      this.schedule(() => {
        if (this.socket) {
          this.socket.emit('game:next');
        }
      }, 200 + Math.random() * 500);
    }

    if (state.phase !== 'SHOWDOWN' && state.phase !== 'WAITING' && state.phase !== 'FINISHED') {
      this.isReady = false;
    }
  }

  makeDecision(expectedTurnKey) {
    const state = this.latestState;
    if (!state || expectedTurnKey !== this.getTurnKey(state) || !this.isMyTurn(state)) {
      this.pendingTurnKey = null;
      return;
    }

    const me = state.players.find((player) => player.isMe);
    if (!me) {
      this.pendingTurnKey = null;
      return;
    }

    const actions = state.actions || [];
    if (actions.length === 0) {
      this.pendingTurnKey = null;
      return;
    }

    const callAmount = state.currentBet - (me.bet || 0);
    const random = Math.random();
    let payload;

    if (random < 0.12 && actions.includes('raise')) {
      const raiseAmount = Math.min(me.chips, Math.max(callAmount + Math.floor(state.pot * 0.4), state.currentBet + 20));
      payload = { action: 'raise', amount: raiseAmount };
    } else if (random < 0.22 && actions.includes('allin')) {
      payload = { action: 'allin' };
    } else if (callAmount === 0 && actions.includes('check')) {
      payload = { action: 'check' };
    } else if (actions.includes('call')) {
      payload = { action: 'call' };
    } else if (actions.includes('check')) {
      payload = { action: 'check' };
    } else {
      payload = { action: 'fold' };
    }

    this.socket.emit('game:action', payload);
    this.actedTurnKey = expectedTurnKey;
    this.pendingTurnKey = null;
  }

  schedule(fn, delayMs) {
    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      fn();
    }, delayMs);

    this.pendingTimers.add(timer);
  }

  disconnect() {
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

class TournamentRunner {
  constructor({ apiUrl, stakeLevel, startingChips, playerCount, accountPrefix }) {
    this.apiUrl = apiUrl;
    this.stakeLevel = stakeLevel;
    this.startingChips = startingChips;
    this.playerCount = playerCount;
    this.accountPrefix = accountPrefix;
    this.tournament = null;
    this.basePort = TOURNAMENT_BASE_PORT;
  }

  async loadPlayers() {
    const result = await query(
      `SELECT id, username, avatar_url
       FROM users
       WHERE username LIKE $1
       ORDER BY username
       LIMIT $2`,
      [`${this.accountPrefix}%`, this.playerCount]
    );

    if (result.rows.length < this.playerCount) {
      throw new Error(`Need ${this.playerCount} accounts with prefix ${this.accountPrefix}, found ${result.rows.length}`);
    }

    return result.rows.map((row, index) => ({
      id: row.id,
      username: row.username,
      avatar_url: row.avatar_url,
      seed: index + 1,
      token: createToken(row),
    }));
  }

  async run() {
    await initTournamentSchema();
    const allPlayers = await this.loadPlayers();

    this.tournament = await createTournament({
      name: `Tournament ${new Date().toISOString()}`,
      totalPlayers: allPlayers.length,
      buyInChips: this.startingChips,
    });

    await registerPlayers(this.tournament.id, allPlayers);

    let roundNumber = 1;
    let activePlayers = allPlayers;

    while (activePlayers.length > 1) {
      const roundConfig = getRoundConfig(activePlayers.length);
      const qualifiers = await this.runRound(roundNumber, roundConfig, activePlayers);
      activePlayers = activePlayers.filter((player) => qualifiers.includes(player.id));
      roundNumber += 1;
    }

    if (activePlayers.length !== 1) {
      throw new Error('Tournament ended without a single champion');
    }

    await completeTournament(this.tournament.id, activePlayers[0].id);
    console.log(`Champion: ${activePlayers[0].username}`);
  }

  async runRound(roundNumber, config, players) {
    console.log(`\nRound ${roundNumber}: ${config.roundName}, players=${players.length}, tableSize=${config.tableSize}, advance=${config.advanceCount}`);

    const round = await createRound({
      tournamentId: this.tournament.id,
      roundNumber,
      roundName: config.roundName,
      tableSize: config.tableSize,
      advanceCount: config.advanceCount,
    });

    const playerTables = chunk(players, config.tableSize);
    const qualifiers = [];

    for (let index = 0; index < playerTables.length; index++) {
      const tableNo = index + 1;
      const tableQualifiers = await this.runTable({
        roundId: round.id,
        tableNo,
        players: playerTables[index],
        advanceCount: config.advanceCount,
        port: this.basePort,
      });

      qualifiers.push(...tableQualifiers);
    }

    const eliminated = players.map((player) => player.id).filter((id) => !qualifiers.includes(id));

    await markRoundResults(this.tournament.id, roundNumber, qualifiers, eliminated);
    await completeRound(round.id);

    await sleep(500);
    return qualifiers;
  }

  async runTable({ roundId, tableNo, players, advanceCount, port }) {
    const table = await createTable(roundId, tableNo, players, this.startingChips);
    await resetBalances(players.map((player) => player.id), this.startingChips);
    await sleep(300);

    const serverProcess = await this.startTableServer(port);
    const bots = players.map((player) => new TournamentBot(player, `http://localhost:${port}`, this.stakeLevel));

    let roomId = null;
    let completed = false;
    let lastAdvanceSnapshot = [];
    let resolveTable;
    let rejectTable;

    const tableFinished = new Promise((resolve, reject) => {
      resolveTable = resolve;
      rejectTable = reject;
    });

    const maybeFinish = async (state) => {
      if (completed) return;

      const survivingPlayers = (state.players || [])
        .filter((player) => player.chips > 0 && !player.disconnected)
        .map((player) => player.id);

      if (survivingPlayers.length === advanceCount) {
        lastAdvanceSnapshot = survivingPlayers;
      }

      if (survivingPlayers.length > advanceCount) return;

      let qualifierIds = survivingPlayers;
      if (qualifierIds.length !== advanceCount) {
        if (lastAdvanceSnapshot.length === advanceCount) {
          qualifierIds = [...lastAdvanceSnapshot];
        } else {
          return;
        }
      }

      completed = true;
      console.log(`Table ${tableNo} completed. Qualifiers: ${qualifierIds.join(', ')}`);

      const eliminated = players
        .map((player) => player.id)
        .filter((id) => !qualifierIds.includes(id));

      await finalizeTable(table.id, qualifierIds, eliminated);
      resolveTable(qualifierIds);
    };

    try {
      for (const bot of bots) {
        bot.on('roomAssigned', async ({ roomId: assignedRoomId }) => {
          if (roomId) return;
          roomId = assignedRoomId;
          console.log(`Table ${tableNo} assigned room ${roomId}`);
          await attachRoomId(table.id, roomId);
        });

        bot.on('state', async ({ state }) => {
          await maybeFinish(state);
        });

        bot.on('disconnected', () => {
          if (!completed) {
            rejectTable(new Error(`Table ${tableNo} disconnected before completion`));
          }
        });
      }

      await Promise.all(bots.map((bot) => bot.connect()));
      for (const bot of bots) {
        bot.joinLobby();
        await sleep(20);
      }

      const qualifiers = await tableFinished;
      return qualifiers;
    } finally {
      bots.forEach((bot) => bot.disconnect());
      await this.stopTableServer(serverProcess);
      await sleep(200);
    }
  }

  async startTableServer(port) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['index.js'], {
        cwd: SERVER_DIR,
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let settled = false;
      const readyPattern = `http://localhost:${port}`;

      const onData = (chunk) => {
        const text = chunk.toString();
        if (!settled && text.includes(readyPattern)) {
          settled = true;
          resolve(child);
        }
      };

      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.once('exit', (code) => {
        if (!settled) {
          settled = true;
          reject(new Error(`Table server on port ${port} exited early with code ${code}`));
        }
      });
    });
  }

  async stopTableServer(child) {
    if (!child || child.exitCode !== null) {
      return;
    }

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, 2000);

      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      child.kill('SIGINT');
    });
  }
}

async function main() {
  const runner = new TournamentRunner({
    apiUrl: API_URL,
    stakeLevel: STAKE_LEVEL,
    startingChips: STARTING_CHIPS,
    playerCount: PLAYER_COUNT,
    accountPrefix: ACCOUNT_PREFIX,
  });

  await runner.run();
}

main()
  .catch((error) => {
    console.error('Tournament failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
