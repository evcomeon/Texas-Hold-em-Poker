// ============================================================
// Texas Hold'em Poker - Multiplayer Game Engine
// ============================================================

const { createDeck, shuffle, cardToString } = require('./deck');
const { evaluateBest, compareHands } = require('./evaluator');

const PHASES = ['WAITING', 'PRE_FLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN', 'FINISHED'];

class GameEngine {
  constructor() {
    this.players = [];
    this.deck = [];
    this.communityCards = [];
    this.pot = 0;
    this.sidePots = [];
    this.phase = 'WAITING';
    this.dealerIndex = 0;
    this.currentPlayerIndex = 0;
    this.smallBlind = 10;
    this.bigBlind = 20;
    this.minRaise = 20;
    this.currentBet = 0;
    this.history = [];
    this.handNumber = 0;
    this.currentHandLog = [];
    this.lastAction = null;
    this.roundInitiator = -1;
    this.readyForNext = new Set(); // Track who has requested next hand
  }

  _log(msg) {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    this.currentHandLog.push(`[${time}] ${msg}`);
  }

  // ── Initialization ──────────────────────────────────────────

  createGame(users) {
    this.players = users.map((u, i) => ({
      id: u.id,
      name: u.name,
      picture: u.picture,
      chips: u.chips || 1000,
      holeCards: [],
      bet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
      isDealer: false,
      isActive: true,
      disconnected: false 
    }));
    this.dealerIndex = 0;
    this.handNumber = 0;
    this.history = [];
    this.startNewHand();
  }

  // ── New Hand ────────────────────────────────────────────────

  startNewHand() {
    this.handNumber++;
    this.currentHandLog = [];
    this.readyForNext.clear();

    // Reset player states
    for (const p of this.players) {
      p.holeCards = [];
      p.bet = 0;
      p.totalBet = 0;
      p.folded = false;
      p.allIn = false;
      if (p.chips <= 0) {
        p.isActive = false; // Could auto-rebuy or kick out
      }
    }

    // Check if enough active players
    const activePlayers = this.players.filter(p => p.isActive && !p.disconnected);
    if (activePlayers.length < 2) {
      this.phase = 'FINISHED';
      this._log("等待更多玩家加入...");
      return;
    }

    // Rotate dealer
    this.dealerIndex = this._nextActivePlayer(this.dealerIndex);
    this.players.forEach((p, i) => p.isDealer = (i === this.dealerIndex));

    // Shuffle deck
    this.deck = shuffle(createDeck());
    this.communityCards = [];
    this.pot = 0;
    this.sidePots = [];
    this.currentBet = 0;
    this.lastAction = null;

    // Deal hole cards
    for (let round = 0; round < 2; round++) {
      for (const p of this.players) {
        if (p.isActive) {
          p.holeCards.push(this.deck.pop());
        }
      }
    }

    // Post blinds
    const sbIndex = this._nextActivePlayer(this.dealerIndex);
    const bbIndex = this._nextActivePlayer(sbIndex);

    this._postBlind(sbIndex, this.smallBlind);
    this._postBlind(bbIndex, this.bigBlind);

    this.currentBet = this.bigBlind;
    this.minRaise = this.bigBlind;
    this.phase = 'PRE_FLOP';

    // First to act is after BB
    this.currentPlayerIndex = this._nextActivePlayer(bbIndex);
    this.roundInitiator = this.currentPlayerIndex;

    this._log(`=== 第 ${this.handNumber} 手 ===`);
    this._log(`庄家: ${this.players[this.dealerIndex].name}`);
    this._log(`小盲: ${this.players[sbIndex].name} (${this.smallBlind})`);
    this._log(`大盲: ${this.players[bbIndex].name} (${this.bigBlind})`);
  }

  _postBlind(playerIndex, amount) {
    const p = this.players[playerIndex];
    if (!p) return;
    const actual = Math.min(amount, p.chips);
    p.chips -= actual;
    p.bet += actual;
    p.totalBet += actual;
    this.pot += actual;
    if (p.chips === 0) p.allIn = true;
  }

  // ── Connection / Disconnection ──────────────────────────────

  handleDisconnect(userId) {
    const p = this.players.find(x => x.id === userId);
    if (p) {
      p.disconnected = true;
      this._log(`${p.name} 掉线`);
      
      // Auto fold if it's their turn or they are non-folded
      if (!p.folded && this.phase !== 'SHOWDOWN' && this.phase !== 'FINISHED') {
         this.performAction(userId, 'fold');
      }
    }
  }

  // ── Player Actions ──────────────────────────────────────────

  performAction(userId, action, amount = 0) {
    const player = this.players[this.currentPlayerIndex];

    if (!player || player.id !== userId) {
      return { error: '不是你的回合' };
    }
    if (this.phase === 'WAITING' || this.phase === 'SHOWDOWN' || this.phase === 'FINISHED') {
      return { error: `当前阶段(${this.phase})不能操作` };
    }

    return this._executeAction(this.currentPlayerIndex, action, amount);
  }

  _executeAction(playerIndex, action, amount = 0) {
    const player = this.players[playerIndex];

    switch (action) {
      case 'fold':
        player.folded = true;
        this._log(`${player.name} 弃牌`);
        this.lastAction = { player: player.name, action: '弃牌' };
        break;

      case 'check':
        if (player.bet < this.currentBet) {
          return { error: '不能过牌，需要跟注或弃牌' };
        }
        this._log(`${player.name} 过牌`);
        this.lastAction = { player: player.name, action: '过牌' };
        break;

      case 'call': {
        const callAmount = Math.min(this.currentBet - player.bet, player.chips);
        player.chips -= callAmount;
        player.bet += callAmount;
        player.totalBet += callAmount;
        this.pot += callAmount;
        if (player.chips === 0) player.allIn = true;
        this._log(`${player.name} 跟注 ${callAmount}`);
        this.lastAction = { player: player.name, action: '跟注', amount: callAmount };
        break;
      }

      case 'raise': {
        const raiseTotal = Math.max(amount, this.currentBet + this.minRaise);
        const raiseAmount = Math.min(raiseTotal - player.bet, player.chips);
        player.chips -= raiseAmount;
        player.bet += raiseAmount;
        player.totalBet += raiseAmount;
        this.pot += raiseAmount;
        if (player.bet > this.currentBet) {
          this.minRaise = player.bet - this.currentBet;
          this.currentBet = player.bet;
          this.roundInitiator = playerIndex;
        }
        if (player.chips === 0) player.allIn = true;
        this._log(`${player.name} 加注到 ${player.bet}`);
        this.lastAction = { player: player.name, action: '加注', amount: player.bet };
        break;
      }

      case 'allin': {
        const allInAmount = player.chips;
        player.chips = 0;
        player.bet += allInAmount;
        player.totalBet += allInAmount;
        this.pot += allInAmount;
        player.allIn = true;
        if (player.bet > this.currentBet) {
          this.minRaise = player.bet - this.currentBet;
          this.currentBet = player.bet;
          this.roundInitiator = playerIndex;
        }
        this._log(`${player.name} 全下 ${allInAmount}`);
        this.lastAction = { player: player.name, action: '全下', amount: allInAmount };
        break;
      }

      default:
        return { error: `未知操作: ${action}` };
    }

    // Check if only one player remains
    const activePlayers = this.players.filter(p => p.isActive && !p.folded && !p.disconnected);
    if (activePlayers.length <= 1) {
      if (activePlayers.length === 1) {
        this._winByFold(activePlayers[0]);
      } else {
         this.phase = 'FINISHED'; // Everyone folded / disconnected
      }
      return this.getState(userId);
    }

    // Move to next player
    this._advanceTurn();

    return this.getState(userId);
  }

  _advanceTurn() {
    let next = this._nextActiveBettingPlayer(this.currentPlayerIndex);

    // Check if round is complete
    if (next === this.roundInitiator || next === -1) {
      this._advancePhase();
      return;
    }

    // Check if all non-folded players have matched the bet or are all-in
    const needAction = this.players.filter(p => p.isActive && !p.folded && !p.disconnected && !p.allIn && p.bet < this.currentBet);
    const canAct = this.players.filter(p => p.isActive && !p.folded && !p.disconnected && !p.allIn);

    if (needAction.length === 0 && canAct.length <= 1 && this._hasEveryoneActed()) {
      this._advancePhase();
      return;
    }

    this.currentPlayerIndex = next;
  }

  _hasEveryoneActed() {
    return this.players.every(p =>
      !p.isActive || p.folded || p.disconnected || p.allIn || p.bet === this.currentBet
    );
  }

  _nextActivePlayer(from) {
    let idx = (from + 1) % this.players.length;
    let count = 0;
    while (count < this.players.length) {
      if (this.players[idx].isActive && !this.players[idx].disconnected) return idx;
      idx = (idx + 1) % this.players.length;
      count++;
    }
    return from;
  }

  _nextActiveBettingPlayer(from) {
    let idx = (from + 1) % this.players.length;
    let count = 0;
    while (count < this.players.length) {
      const p = this.players[idx];
      if (p.isActive && !p.folded && !p.disconnected && !p.allIn) {
        return idx;
      }
      idx = (idx + 1) % this.players.length;
      count++;
    }
    return -1; // No more players can act
  }

  // ── Phase Progression ───────────────────────────────────────

  _advancePhase() {
    // Reset bets for next round
    for (const p of this.players) {
      p.bet = 0;
    }
    this.currentBet = 0;
    this.minRaise = this.bigBlind;

    switch (this.phase) {
      case 'PRE_FLOP':
        this.phase = 'FLOP';
        this.communityCards.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
        this._log(`翻牌: ${this.communityCards.map(cardToString).join(' ')}`);
        break;
      case 'FLOP':
        this.phase = 'TURN';
        this.communityCards.push(this.deck.pop());
        this._log(`转牌: ${cardToString(this.communityCards[3])}`);
        break;
      case 'TURN':
        this.phase = 'RIVER';
        this.communityCards.push(this.deck.pop());
        this._log(`河牌: ${cardToString(this.communityCards[4])}`);
        break;
      case 'RIVER':
        this._showdown();
        return;
    }

    const canAct = this.players.filter(p => p.isActive && !p.folded && !p.disconnected && !p.allIn);
    if (canAct.length <= 1) {
      this._runOutBoard();
      return;
    }

    this.currentPlayerIndex = this._nextActiveBettingPlayer(this.dealerIndex);
    if (this.currentPlayerIndex === -1) {
      this._runOutBoard();
      return;
    }
    this.roundInitiator = this.currentPlayerIndex;
  }

  _runOutBoard() {
    while (this.communityCards.length < 5) {
      this.communityCards.push(this.deck.pop());
    }
    if (this.phase !== 'SHOWDOWN') {
      this._log(`公共牌: ${this.communityCards.map(cardToString).join(' ')}`);
    }
    this._showdown();
  }

  // ── Showdown & Settlement ───────────────────────────────────

  _showdown() {
    this.phase = 'SHOWDOWN';
    const activePlayers = this.players.filter(p => p.isActive && !p.folded && !p.disconnected);

    const results = [];
    for (const p of activePlayers) {
      const best = evaluateBest([...p.holeCards, ...this.communityCards]);
      results.push({
        playerId: p.id,
        playerName: p.name,
        holeCards: p.holeCards,
        best,
        totalBet: p.totalBet
      });
      this._log(`${p.name}: ${best.name} (${p.holeCards.map(cardToString).join(' ')})`);
    }

    results.sort((a, b) => compareHands(b.best, a.best));
    this._distributePot(results);

    this.history.push({
      handNumber: this.handNumber,
      communityCards: this.communityCards.map(cardToString),
      results: results.map(r => ({
        name: r.playerName,
        hand: r.best.name,
        cards: r.holeCards.map(cardToString),
        won: r.won || 0
      })),
      log: [...this.currentHandLog]
    });

    this.lastAction = {
      player: 'system',
      action: 'showdown',
      results: results.map(r => ({
        name: r.playerName,
        hand: r.best.name,
        cards: r.holeCards.map(cardToString),
        won: r.won || 0
      }))
    };
  }

  _distributePot(results) {
    let remainingPot = this.pot;
    const allBets = [...new Set(results.map(r => r.totalBet))].sort((a, b) => a - b);

    let prevBet = 0;
    for (const betLevel of allBets) {
      const increment = betLevel - prevBet;
      if (increment <= 0) continue;

      const eligible = this.players.filter(p => p.isActive && p.totalBet >= betLevel);
      const potPortion = increment * eligible.length;

      const eligibleResults = results.filter(r =>
        eligible.some(p => p.id === r.playerId) && !this.players.find(x => x.id === r.playerId).folded
      );

      if (eligibleResults.length > 0) {
        const bestHand = eligibleResults[0].best;
        const winners = eligibleResults.filter(r => compareHands(r.best, bestHand) === 0);
        const share = Math.floor(potPortion / winners.length);

        for (const w of winners) {
          const wObj = this.players.find(x => x.id === w.playerId);
          wObj.chips += share;
          w.won = (w.won || 0) + share;
          this._log(`${w.playerName} 赢得 ${share} 筹码`);
        }
        remainingPot -= share * winners.length;
      }

      prevBet = betLevel;
    }

    if (remainingPot > 0 && results.length > 0) {
      const nonFolded = results.filter(r => !this.players.find(x=>x.id === r.playerId).folded);
      if (nonFolded.length > 0) {
        const wObj = this.players.find(x => x.id === nonFolded[0].playerId);
        wObj.chips += remainingPot;
        nonFolded[0].won = (nonFolded[0].won || 0) + remainingPot;
      }
    }
  }

  _winByFold(winner) {
    winner.chips += this.pot;
    this._log(`${winner.name} 赢得 ${this.pot} 筹码 (其他人弃牌)`);

    this.history.push({
      handNumber: this.handNumber,
      communityCards: this.communityCards.map(cardToString),
      results: [{ name: winner.name, hand: '其他人弃牌', cards: [], won: this.pot }],
      log: [...this.currentHandLog]
    });

    this.lastAction = {
      player: 'system',
      action: 'win_by_fold',
      winner: winner.name,
      amount: this.pot
    };

    this.phase = 'SHOWDOWN';
  }

  // ── Multiplayer Turn coordination ───────────────────────────

  playerRequestedNextHand(userId) {
    this.readyForNext.add(userId);
    const activePlayers = this.players.filter(p => !p.disconnected);
    if (this.readyForNext.size >= activePlayers.length) {
      return { ready: true };
    }
    return { ready: false, count: this.readyForNext.size, total: activePlayers.length };
  }

  nextHand() {
    if (this.phase !== 'SHOWDOWN' && this.phase !== 'FINISHED') {
      return { error: '当前手牌尚未结束' };
    }

    // basic rebuy for busted players
    for (const p of this.players) {
      if (p.chips <= 0) {
        p.chips = 1000;
        p.isActive = true;
      }
    }

    this.startNewHand();
  }

  // ── State Getter ────────────────────────────────────────────
  // Filters hole cards of opponents

  getState(viewerUserId) {
    const isShowdown = this.phase === 'SHOWDOWN';

    return {
      phase: this.phase,
      handNumber: this.handNumber,
      pot: this.pot,
      communityCards: this.communityCards.map(c => ({
        rank: c.rank,
        suit: c.suit,
        display: cardToString(c)
      })),
      currentBet: this.currentBet,
      currentPlayerIndex: this.currentPlayerIndex,
      dealerIndex: this.dealerIndex,
      lastAction: this.lastAction,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        picture: p.picture,
        chips: p.chips,
        bet: p.bet,
        totalBet: p.totalBet,
        folded: p.folded,
        allIn: p.allIn,
        isDealer: p.isDealer,
        isActive: p.isActive,
        disconnected: p.disconnected,
        holeCards: (p.id === viewerUserId || isShowdown || this.phase === 'FINISHED')
          ? p.holeCards.map(c => ({ rank: c.rank, suit: c.suit, display: cardToString(c) }))
          : p.holeCards.map(() => ({ hidden: true })),
        ...(isShowdown && !p.folded && p.isActive && this.communityCards.length === 5 ? {
          bestHand: evaluateBest([...p.holeCards, ...this.communityCards])?.name
        } : {})
      })),
      actions: this._getAvailableActions(viewerUserId),
      log: this.currentHandLog.slice(-10)
    };
  }

  _getAvailableActions(userId) {
    if (this.phase === 'SHOWDOWN' || this.phase === 'FINISHED') {
      return ['nextHand']; // Handled as game:next via socket
    }
    if (this.phase === 'WAITING') return [];

    const player = this.players[this.currentPlayerIndex];
    if (!player || player.id !== userId || player.folded || player.allIn || player.disconnected) return [];

    const actions = ['fold'];
    const callAmount = this.currentBet - player.bet;

    if (callAmount === 0) {
      actions.push('check');
    } else {
      actions.push('call');
    }

    if (player.chips > callAmount) {
      actions.push('raise');
    }

    actions.push('allin');

    return actions;
  }
}

module.exports = GameEngine;
