// jest tests for LobbyManager room cleanup (TDD style)

// Mock external dependencies
jest.mock('../lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../game/engine', () => {
  // Simple mock GameEngine class with minimal required properties
  return class MockEngine {
    constructor(config = {}) {
      this.players = [];
      this.spectators = [];
      this.phase = 'WAITING';
      this.config = config;
    }
    // methods used by LobbyManager (no‑ops for tests)
    addPlayer() {}
    addSpectator() {}
    markPlayerRemoved() {}
    startReadyTimer() {}
    handleReconnect() { return true; }
  };
});

jest.mock('../models/user', () => ({
  findById: jest.fn().mockResolvedValue(null),
  updateChips: jest.fn().mockResolvedValue(null),
}));

jest.mock('../models/apiKey', () => ({
  validateKey: jest.fn().mockResolvedValue({ valid: true, keyData: {} }),
}));

const LobbyManager = require('../lobby');
const logger = require('../lib/logger');

// Helper to create a dummy socket with jest mock emit
function createMockSocket() {
  return { emit: jest.fn(), join: jest.fn() };
}

describe('LobbyManager – room cleanup (TDD)', () => {
  let lobby;
  beforeEach(() => {
    lobby = new LobbyManager();
    // ensure clean logger mocks between tests
    logger.info.mockClear();
    logger.warn.mockClear();
    logger.error.mockClear();
  });

  test('leaveGame removes empty room and logs', () => {
    const socketId = 'sock1';
    const mockSocket = createMockSocket();
    const user = { id: 1, username: 'alice' };
    // Simulate a room with no other players or spectators
    const roomId = 'room_empty';
    const engine = { players: [], spectators: [] };
    lobby.activeGames.set(roomId, {
      engine,
      players: [],
      spectators: [],
      maxPlayers: 8,
      stakeLevel: 'medium',
    });
    lobby.tables.set(roomId, { isFull: () => false });
    lobby.connectedUsers.set(socketId, { user, socket: mockSocket, roomId, isSpectator: false });

    const result = lobby.leaveGame(socketId);
    // after leaving, the room should be removed
    expect(lobby.activeGames.has(roomId)).toBe(false);
    expect(lobby.tables.has(roomId)).toBe(false);
    // logger should record removal
    expect(logger.info).toHaveBeenCalledWith('lobby.room_removed', { roomId, reason: 'empty' });
    // result should contain room info
    expect(result).toMatchObject({ roomId, userName: 'alice', wasSpectator: false });
  });

  test('_onDisconnectTimeout deletes room when not enough active players', () => {
    const roomId = 'room_disconnect';
    const playerId = 2;
    // Mock engine with a single active player (the one that will time out)
    const engine = {
      players: [
        { id: playerId, connectionState: 'online', chips: 100, name: 'bob' },
        { id: 3, connectionState: 'online', chips: 100, name: 'carol' },
      ],
      phase: 'PRE_FLOP',
    };
    // After timeout, we simulate that only one player remains active (playerId will be removed)
    engine.players[0].connectionState = 'removed'; // simulate removal inside timeout handling

    lobby.activeGames.set(roomId, {
      engine,
      players: engine.players,
      spectators: [],
      maxPlayers: 8,
      stakeLevel: 'medium',
    });
    lobby.tables.set(roomId, { isFull: () => false });

    // Call the private method via bracket notation
    lobby['_onDisconnectTimeout'](roomId, playerId);

    // Expect the room to be deleted because active players < 2
    expect(lobby.activeGames.has(roomId)).toBe(false);
    expect(lobby.tables.has(roomId)).toBe(false);
    expect(logger.info).toHaveBeenCalledWith('lobby.room_removed', { roomId, reason: 'empty' });
  });
});
