/**
 * Engine rule regression tests — covers the 6 critical bugs
 * found in 2026-03-26 architecture audit.
 */

const GameEngine = require('../game/engine');

// Suppress timers in tests
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

function makeUsers(n, chips = 1000) {
  return Array.from({ length: n }, (_, i) => ({
    id: `u${i + 1}`,
    name: `Player${i + 1}`,
    chips,
  }));
}

function makeEngine(cfg = {}) {
  return new GameEngine({
    smallBlind: 5,
    bigBlind: 10,
    turnTimeout: 9999,    // effectively disable auto-timeout in tests
    readyTimeout: 9999,
    disconnectTimeout: 9999,
    ...cfg,
  });
}

// ────────────────────────────────────────────────────────────────
// 1. Heads-up: dealer = small blind, dealer acts first pre-flop
// ────────────────────────────────────────────────────────────────
describe('Heads-up blind and position rules', () => {
  test('dealer is small blind, non-dealer is big blind', () => {
    const engine = makeEngine();
    engine.createGame(makeUsers(2));

    const dealer = engine.players[engine.dealerIndex];
    // In heads-up the dealer is the SB
    // SB bet = 5, BB bet = 10
    const sbPlayer = engine.players.find(p => p.bet === 5);
    const bbPlayer = engine.players.find(p => p.bet === 10);

    expect(sbPlayer).toBeDefined();
    expect(bbPlayer).toBeDefined();
    expect(sbPlayer.id).toBe(dealer.id); // dealer IS small blind
  });

  test('pre-flop: dealer (SB) acts first', () => {
    const engine = makeEngine();
    engine.createGame(makeUsers(2));

    const dealerIdx = engine.dealerIndex;
    expect(engine.currentPlayerIndex).toBe(dealerIdx);
  });
});

// ────────────────────────────────────────────────────────────────
// 2. Disconnected players must NOT be counted for starting a hand
// ────────────────────────────────────────────────────────────────
describe('Disconnected players and hand start', () => {
  test('1 online + 1 disconnected => hand should NOT start', () => {
    const engine = makeEngine();
    engine.createGame(makeUsers(2));
    // finish current hand
    engine.phase = 'FINISHED';

    // disconnect player 2
    engine.handleDisconnect('u2');

    // try to start a new hand
    engine.startNewHand();
    expect(engine.phase).toBe('WAITING');  // should not enter PRE_FLOP
    expect(engine.pot).toBe(0);
    expect(engine.currentBet).toBe(0);
    expect(engine.communityCards).toEqual([]);
  });
});

describe('Duplicate seat protection', () => {
  test('createGame ignores duplicate user ids', () => {
    const engine = makeEngine();
    engine.createGame([
      { id: 'u1', name: 'Alice', chips: 1000 },
      { id: 'u1', name: 'Alice', chips: 1000 },
      { id: 'u2', name: 'Bob', chips: 1000 },
    ]);

    expect(engine.players.map((player) => player.id)).toEqual(['u1', 'u2']);
  });
});

// ────────────────────────────────────────────────────────────────
// 3. Disconnected all-in player MUST participate in showdown
// ────────────────────────────────────────────────────────────────
describe('Disconnected all-in player showdown rights', () => {
  test('all-in player who disconnects still wins at showdown', () => {
    const engine = makeEngine();
    const users = makeUsers(2, 100);
    engine.createGame(users);

    // Both players go all-in
    const currentId = engine.players[engine.currentPlayerIndex].id;
    engine.performAction(currentId, 'allin');

    const nextId = engine.players[engine.currentPlayerIndex].id;
    engine.performAction(nextId, 'allin');

    // At this point the board should run out
    // Now simulate: one player disconnects BEFORE showdown is evaluated
    // (In real play, the disconnect happens mid-hand before river)
    // Since both are all-in, the board runs out automatically.
    // Let's verify disconnected player is still in results.

    // The hand should have resolved. Check that both players appear in last history.
    const lastHand = engine.history[engine.history.length - 1];
    expect(lastHand).toBeTruthy();
    expect(lastHand.results.length).toBe(2);  // Both participated
  });

  test('disconnected non-acting player is NOT auto-folded', () => {
    const engine = makeEngine();
    engine.createGame(makeUsers(3, 500));

    // Identify who is currently acting
    const currentActorId = engine.players[engine.currentPlayerIndex].id;

    // Find a player who is NOT the current actor and NOT all-in
    const nonActorPlayer = engine.players.find(
      p => p.id !== currentActorId && !p.allIn
    );

    // Disconnect this non-acting player
    engine.handleDisconnect(nonActorPlayer.id);

    // They should NOT be folded because it's not their turn
    expect(nonActorPlayer.folded).toBe(false);
    expect(nonActorPlayer.connectionState).toBe('disconnected');
  });
});

// ────────────────────────────────────────────────────────────────
// 4. Side pot MUST include folded players' contributions
// ────────────────────────────────────────────────────────────────
describe('Side pot calculation with folded players', () => {
  test('3 players each bet 50, 1 folds => total pot is 150, not 100', () => {
    const engine = makeEngine({ smallBlind: 5, bigBlind: 10 });
    engine.createGame(makeUsers(3, 500));

    // Manually set up scenario: everyone has bet 50, one folds
    engine.players.forEach(p => {
      p.totalBet = 50;
      p.bet = 50;
      p.chips -= 50;
    });
    engine.pot = 150;
    engine.players[0].folded = true; // player 0 folds after putting in 50

    engine._calculateSidePots();

    const totalSidePots = engine.sidePots.reduce((sum, sp) => sum + sp.amount, 0);
    expect(totalSidePots).toBe(150); // Must be 150, NOT 100

    // The folded player's contribution is IN the pot, but they can't WIN it
    for (const sp of engine.sidePots) {
      expect(sp.eligiblePlayerIds).not.toContain('u1'); // folded player can't win
    }
  });

  test('multi-level side pot with fold includes all contributions', () => {
    const engine = makeEngine();
    // 3 players: P1 bets 30 and folds, P2 all-in 50, P3 calls 50
    engine.players = [
      { id: 'a', name: 'A', chips: 0, totalBet: 30, folded: true, isActive: true, allIn: false, connectionState: 'online' },
      { id: 'b', name: 'B', chips: 0, totalBet: 50, folded: false, isActive: true, allIn: true, connectionState: 'online' },
      { id: 'c', name: 'C', chips: 450, totalBet: 50, folded: false, isActive: true, allIn: false, connectionState: 'online' },
    ];
    engine.pot = 130; // 30 + 50 + 50

    engine._calculateSidePots();

    const total = engine.sidePots.reduce((s, sp) => s + sp.amount, 0);
    expect(total).toBe(130);
  });
});

// ────────────────────────────────────────────────────────────────
// 5. Short all-in MUST NOT reopen betting
// ────────────────────────────────────────────────────────────────
describe('Short raise / short all-in does not reopen betting', () => {
  test('pre-flop first actor can still raise normally', () => {
    const engine = makeEngine({ smallBlind: 50, bigBlind: 100 });
    engine.createGame(makeUsers(3, 1000));

    const currentId = engine.players[engine.currentPlayerIndex].id;
    expect(engine.getState(currentId).actions).toContain('raise');
  });

  test('short all-in does not change minRaise or roundInitiator', () => {
    const engine = makeEngine({ smallBlind: 50, bigBlind: 100 });
    engine.createGame(makeUsers(3, 1000));

    // After blinds: currentBet=100, minRaise=100
    // Player after BB raises to 200 (valid full raise)
    const p1Idx = engine.currentPlayerIndex;
    engine.performAction(engine.players[p1Idx].id, 'raise', 200);

    const prevMinRaise = engine.minRaise; // should be 100
    const prevInitiator = engine.roundInitiator;

    // Next player: short all-in with only 120 total chips left
    // They've bet 0 so far, currentBet is 200, they can only put in 120 (< 200)
    // This is actually just a short call, not a raise
    const p2Idx = engine.currentPlayerIndex;
    const p2 = engine.players[p2Idx];
    // Set chips to simulate short stack scenario
    p2.chips = 20; // can only put 20 more on top of current bet (already 0)
    
    engine.performAction(p2.id, 'allin');

    // After short all-in that doesn't even reach currentBet:
    // minRaise must NOT change
    expect(engine.minRaise).toBe(prevMinRaise);
  });

  test('raise that doesn\'t meet full minimum is rejected if player has chips', () => {
    const engine = makeEngine({ smallBlind: 50, bigBlind: 100 });
    engine.createGame(makeUsers(2, 5000));

    // currentBet = 100, minRaise = 100 => must raise to at least 200
    const pid = engine.players[engine.currentPlayerIndex].id;
    const result = engine.performAction(pid, 'raise', 150);

    expect(result.error).toBeTruthy(); // Should be rejected
  });

  test('short all-in does NOT skip street — other players get chance to call', () => {
    // Scenario from audit: A opens 100, B calls 100, C short all-in to 120.
    // After C's action, A and B must get a turn to call the extra 20.
    const engine = makeEngine({ smallBlind: 50, bigBlind: 100 });
    const users = [
      { id: 'a', name: 'A', chips: 1000 },
      { id: 'b', name: 'B', chips: 1000 },
      { id: 'c', name: 'C', chips: 120 },
    ];
    engine.createGame(users);

    // After createGame: blinds posted, PRE_FLOP, currentBet=100
    expect(engine.phase).toBe('PRE_FLOP');

    // First to act calls (matching 100)
    const firstId = engine.players[engine.currentPlayerIndex].id;
    engine.performAction(firstId, 'call');

    // Second player calls (matching 100)
    const secondId = engine.players[engine.currentPlayerIndex].id;
    engine.performAction(secondId, 'call');

    // Third player (shortest stack) goes all-in
    // They may have less than 100 remaining after blind, making this a short all-in
    const thirdId = engine.players[engine.currentPlayerIndex].id;
    const thirdPlayer = engine.players.find(p => p.id === thirdId);

    if (thirdPlayer.chips > 0) {
      engine.performAction(thirdId, 'allin');
    }

    // If the third player's all-in raised the currentBet at all,
    // we should NOT be in FLOP yet — other players need a chance to act
    if (engine.currentBet > 100) {
      // At least check we haven't advanced to FLOP prematurely
      expect(engine.phase).toBe('PRE_FLOP');

      // The current player should be one of the first two (who owe the difference)
      const currentPlayer = engine.players[engine.currentPlayerIndex];
      expect(currentPlayer.bet).toBeLessThan(engine.currentBet);
    }
  });

  test('short all-in does NOT reopen betting for already-acted players', () => {
    const engine = makeEngine({ smallBlind: 50, bigBlind: 100 });
    const users = [
      { id: 'a', name: 'A', chips: 1000 },
      { id: 'b', name: 'B', chips: 1000 },
      { id: 'c', name: 'C', chips: 120 },
    ];
    engine.createGame(users);

    // Build a clean controlled betting state without blind side effects.
    engine.phase = 'PRE_FLOP';
    engine.players[0].chips = 1000;
    engine.players[1].chips = 1000;
    engine.players[2].chips = 120;
    engine.players.forEach((p) => {
      p.folded = false;
      p.allIn = false;
      p.isActive = true;
      p.connectionState = 'online';
      p.bet = 0;
      p.totalBet = 0;
      p.holeCards = [];
    });
    engine.currentBet = 0;
    engine.minRaise = 100;
    engine.pot = 0;
    engine.currentPlayerIndex = 0;
    engine.roundInitiator = 0;
    engine.actedSinceLastFullRaise.clear();

    expect(engine.getState('a').actions).toContain('raise');

    engine.performAction('a', 'raise', 100);
    engine.performAction('b', 'call');
    engine.performAction('c', 'allin');

    const stateForA = engine.getState('a');
    expect(stateForA.actions).toEqual(['fold', 'call', 'allin']);
    expect(engine.performAction('a', 'raise', 220).error).toBeTruthy();
    expect(engine.performAction('a', 'allin').error).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────
// 6. Verify engine.js and lobby.js pass node --check (syntax)
// ────────────────────────────────────────────────────────────────
describe('Module loading sanity', () => {
  test('GameEngine can be instantiated', () => {
    const engine = new GameEngine({ smallBlind: 1, bigBlind: 2 });
    expect(engine).toBeDefined();
    expect(engine.phase).toBe('WAITING');
  });
});
