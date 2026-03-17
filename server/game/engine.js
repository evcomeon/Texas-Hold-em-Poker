// ============================================================
// Texas Hold'em Poker - Multiplayer Game Engine (支持观战)
// Fix: 修复边池计算逻辑，确保多全下场景分配正确
// ============================================================

const { createDeck, shuffle, cardToString } = require('./deck');
const { evaluateBest, compareHands } = require('./evaluator');

const PHASES = ['WAITING', 'PRE_FLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN', 'FINISHED'];

class GameEngine {
  constructor(config = {}) {
    this.players = [];
    this.spectators = [];
    this.deck = [];
    this.communityCards = [];
    this.pot = 0;
    this.sidePots = []; // 边池列表 { amount, eligiblePlayerIds }
    this.phase = 'WAITING';
    this.dealerIndex = 0;
    this.currentPlayerIndex = 0;
    this.smallBlind = config.smallBlind || 10;
    this.bigBlind = config.bigBlind || 20;
    this.minRaise = this.bigBlind;
    this.currentBet = 0;
    this.history = [];
    this.handNumber = 0;
    this.currentHandLog = [];
    this.lastAction = null;
    this.roundInitiator = -1;
    this.readyForNext = new Set();
    this.maxPlayers = 8;
    
    this.turnTimeout = parseInt(process.env.TURN_TIMEOUT) || config.turnTimeout || 30;
    this.turnTimer = null;
    this.turnStartTime = null;
    this.onTimeoutCallback = null;
    
    this.readyTimeout = parseInt(process.env.READY_TIMEOUT) || config.readyTimeout || 30;
    this.readyTimer = null;
    this.readyStartTime = null;
    this.onReadyTimeoutCallback = null;
  }

  _log(msg) {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    this.currentHandLog.push(`[${time}] ${msg}`);
  }

  // ── Initialization ──────────────────────────────────────────

  createGame(users) {
    this.players = users.map((u, i) => ({
      id: u.id,
      name: u.name || u.username,
      picture: u.picture,
      chips: u.chips || 1000,
      holeCards: [],
      bet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
      isDealer: false,
      isActive: true,
      disconnected: false,
      isSpectator: false
    }));
    this.dealerIndex = 0;
    this.handNumber = 0;
    this.history = [];
    this.phase = 'WAITING'; // 等待更多玩家加入
    this._log("等待玩家加入...");
    
    // 如果已经有足够的玩家，自动开始游戏
    if (this.players.length >= 2) {
      this.startNewHand();
    }
  }
  
  // ── Add Player (during WAITING or after hand ends) ───────────
  
  addPlayer(user) {
    // 检查是否已存在
    if (this.players.find(p => p.id === user.id)) return false;
    if (this.players.length >= this.maxPlayers) return false;
    
    const playerChips = user.chips || 0;
    const playerName = user.name || user.username;
    
    this.players.push({
      id: user.id,
      name: playerName,
      picture: user.picture,
      chips: playerChips,
      holeCards: [],
      bet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
      isDealer: false,
      isActive: playerChips >= this.bigBlind, // FIX: 需要至少大盲注才能参与
      disconnected: false,
      isSpectator: false
    });
    
    this._log(`${playerName} 加入桌子 (筹码: ${playerChips})`);
    
    // 如果游戏在等待状态且人数够了，自动开始
    if (this.phase === 'WAITING' && this.players.length >= 2) {
      this.startNewHand();
    }
    
    return true;
  }
  
  // ── Remove Player (when disconnected) ────────────────────────
  
  removePlayer(userId) {
    const idx = this.players.findIndex(p => p.id === userId);
    if (idx === -1) return false;
    
    const player = this.players[idx];
    this._log(`${player.name} 离开了桌子`);
    
    // 从数组中移除
    this.players.splice(idx, 1);
    
    // 调整当前玩家索引
    if (this.currentPlayerIndex >= idx && this.currentPlayerIndex > 0) {
      this.currentPlayerIndex--;
    }
    if (this.roundInitiator >= idx && this.roundInitiator > 0) {
      this.roundInitiator--;
    }
    if (this.dealerIndex >= idx && this.dealerIndex > 0) {
      this.dealerIndex--;
    }
    
    return true;
  }
  
  // ── Add Spectator ───────────────────────────────────────────
  
  addSpectator(userId) {
    if (!this.spectators.includes(userId)) {
      this.spectators.push(userId);
    }
  }
  
  removeSpectator(userId) {
    this.spectators = this.spectators.filter(id => id !== userId);
  }

  // ── New Hand ────────────────────────────────────────────────

  startNewHand() {
    this.handNumber++;
    this.currentHandLog = [];
    this.readyForNext.clear();
    this.clearReadyTimer();

    // Reset player states
    for (const p of this.players) {
      p.holeCards = [];
      p.bet = 0;
      p.totalBet = 0;
      p.folded = false;
      p.allIn = false;
      p.isSpectator = false;
      if (p.chips <= 0) {
        p.isActive = false;
      }
    }

    // Check if enough active players
    const activePlayers = this.players.filter(p => p.isActive && !p.disconnected);
    if (activePlayers.length < 2) {
      this.phase = 'WAITING';
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
    this.sidePots = []; // FIX: 重置边池
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

  // ── Timer Management ────────────────────────────────────────

  setOnTimeoutCallback(callback) {
    this.onTimeoutCallback = callback;
  }

  startTurnTimer() {
    this.clearTurnTimer();
    this.turnStartTime = Date.now();
    
    this.turnTimer = setTimeout(() => {
      this._handleTimeout();
    }, this.turnTimeout * 1000);
  }

  clearTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    this.turnStartTime = null;
  }

  getRemainingTime() {
    if (!this.turnStartTime) return this.turnTimeout;
    const elapsed = Math.floor((Date.now() - this.turnStartTime) / 1000);
    return Math.max(0, this.turnTimeout - elapsed);
  }

  _handleTimeout() {
    const player = this.players[this.currentPlayerIndex];
    if (!player || this.phase === 'SHOWDOWN' || this.phase === 'FINISHED' || this.phase === 'WAITING') {
      return;
    }

    this._log(`${player.name} 超时`);

    // 判断是否可以过牌
    const canCheck = player.bet >= this.currentBet;
    const autoAction = canCheck ? 'check' : 'fold';
    
    // 执行自动操作
    const result = this._executeAction(this.currentPlayerIndex, autoAction);
    
    // 通知回调
    if (this.onTimeoutCallback) {
      this.onTimeoutCallback(player.id, autoAction, result);
    }
  }

  // ── Connection / Disconnection ──────────────────────────────

  handleDisconnect(userId) {
    const p = this.players.find(x => x.id === userId);
    if (p) {
      p.disconnected = true;
      this._log(`${p.name} 掉线`);
      
      // Auto fold if it's their turn or they are non-folded
      if (!p.folded && this.phase !== 'SHOWDOWN' && this.phase !== 'FINISHED' && this.phase !== 'WAITING') {
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
    
    // 玩家操作时清除计时器
    this.clearTurnTimer();

    return this._executeAction(this.currentPlayerIndex, action, amount);
  }

  _executeAction(playerIndex, action, amount = 0) {
    const player = this.players[playerIndex];
    const userId = player.id;

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
         this.phase = 'FINISHED';
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
    
    // 启动新回合计时器
    this.startTurnTimer();
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
    return -1;
  }

  // ── Phase Progression ───────────────────────────────────────

  _advancePhase() {
    // 清除当前计时器
    this.clearTurnTimer();
    
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
    
    // 启动新阶段计时器
    this.startTurnTimer();
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
      
      // 显示更详细的牌型信息
      let handDetail = best.name;
      if (best.scores && best.scores.length > 0) {
        if (best.rank === 4) { // 顺子
          const highCard = best.scores[0];
          const highNames = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10', 9: '9', 8: '8', 7: '7', 6: '6', 5: '5' };
          handDetail = `${best.name} (${highNames[highCard] || highCard}高)`;
        }
      }
      this._log(`${p.name}: ${handDetail} (${p.holeCards.map(cardToString).join(' ')})`);
    }

    results.sort((a, b) => compareHands(b.best, a.best));
    
    // FIX: 使用正确的边池计算方法
    this._calculateSidePots();
    this._distributePotWithSidePots(results);

    this.history.push({
      handNumber: this.handNumber,
      communityCards: this.communityCards.map(cardToString),
      results: results.map(r => ({
        name: r.playerName,
        hand: r.best.name,
        cards: r.holeCards.map(cardToString),
        won: r.won || 0
      })),
      sidePots: this.sidePots, // FIX: 记录边池信息
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

  /**
   * FIX: 重新计算边池
   * 根据玩家的totalBet计算所有边池
   */
  _calculateSidePots() {
    this.sidePots = [];
    
    // 获取所有未弃牌的活跃玩家，按totalBet排序
    const activePlayers = this.players
      .filter(p => p.isActive && !p.folded)
      .map(p => ({ ...p }))
      .sort((a, b) => a.totalBet - b.totalBet);
    
    if (activePlayers.length === 0) return;
    
    let processedBet = 0;
    
    for (let i = 0; i < activePlayers.length; i++) {
      const player = activePlayers[i];
      const currentBet = player.totalBet;
      
      if (currentBet <= processedBet) continue;
      
      const betDiff = currentBet - processedBet;
      // 所有有资格参与这个边池的玩家（下注 >= currentBet 的玩家）
      const eligiblePlayers = activePlayers.filter(p => p.totalBet >= currentBet);
      const potAmount = betDiff * eligiblePlayers.length;
      
      this.sidePots.push({
        amount: potAmount,
        eligiblePlayerIds: eligiblePlayers.map(p => p.id),
        betLevel: currentBet
      });
      
      processedBet = currentBet;
    }
    
    // 验证总池是否正确
    const totalSidePots = this.sidePots.reduce((sum, sp) => sum + sp.amount, 0);
    if (totalSidePots !== this.pot) {
      console.warn(`[Engine] Side pot calculation mismatch: ${totalSidePots} vs ${this.pot}`);
    }
  }

  /**
   * FIX: 使用边池分配奖金
   * 每个边池独立计算赢家
   */
  _distributePotWithSidePots(results) {
    // 按牌力排序的结果用于确定每个边池的赢家
    const sortedResults = [...results].sort((a, b) => compareHands(b.best, a.best));
    
    for (const sidePot of this.sidePots) {
      // 获取有资格参与这个边池且未弃牌的玩家
      const eligibleResults = sortedResults.filter(r => 
        sidePot.eligiblePlayerIds.includes(r.playerId)
      );
      
      if (eligibleResults.length === 0) {
        // 如果都弃牌了，将边池给主池赢家（这在实际游戏中不应该发生）
        console.warn(`[Engine] No eligible players for side pot of ${sidePot.amount}`);
        continue;
      }
      
      // 找出这个边池中的最高牌力
      const bestHand = eligibleResults[0].best;
      const winners = eligibleResults.filter(r => compareHands(r.best, bestHand) === 0);
      
      // 平分边池
      const share = Math.floor(sidePot.amount / winners.length);
      const remainder = sidePot.amount % winners.length; // 余数给第一个赢家
      
      for (let i = 0; i < winners.length; i++) {
        const w = winners[i];
        const winAmount = share + (i === 0 ? remainder : 0);
        const wObj = this.players.find(x => x.id === w.playerId);
        
        if (wObj) {
          wObj.chips += winAmount;
          w.won = (w.won || 0) + winAmount;
          
          // 记录日志
          if (this.sidePots.length === 1) {
            this._log(`${w.playerName} 赢得主池 ${winAmount} 筹码`);
          } else {
            this._log(`${w.playerName} 赢得边池(${sidePot.betLevel}) ${winAmount} 筹码`);
          }
        }
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
    // 如果已经开始新一手，不再处理准备请求
    if (this.phase !== 'SHOWDOWN' && this.phase !== 'FINISHED') {
      return { ready: false, count: 0, total: 0, error: '当前阶段不能准备' };
    }
    
    this.readyForNext.add(userId);
    const activePlayers = this.players.filter(p => !p.disconnected && p.chips > 0);
    const count = this.readyForNext.size;
    const total = activePlayers.length;
    
    // 只计算活跃玩家的准备数量
    const readyActiveCount = activePlayers.filter(p => this.readyForNext.has(p.id)).length;
    
    this._log(`准备请求: ${userId}, 活跃玩家: ${activePlayers.map(p => p.name).join(',')}, 准备数: ${readyActiveCount}/${total}`);
    
    // 如果活跃玩家不足2人，需要检查观战者是否有足够筹码
    if (activePlayers.length < 2) {
      this._log(`活跃玩家不足2人，需要检查观战者`);
      // 返回特殊标志，表示需要尝试从观战者中匹配
      return { ready: true, count: readyActiveCount, total, needSpectatorMatch: true };
    }
    
    if (readyActiveCount >= activePlayers.length) {
      this.clearReadyTimer();
      return { ready: true, count: readyActiveCount, total };
    }
    return { ready: false, count: readyActiveCount, total };
  }

  startReadyTimer() {
    this.clearReadyTimer();
    this.readyStartTime = Date.now();
    
    this.readyTimer = setTimeout(() => {
      this._handleReadyTimeout();
    }, this.readyTimeout * 1000);
  }

  clearReadyTimer() {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    this.readyStartTime = null;
  }

  getReadyRemainingTime() {
    if (!this.readyStartTime) return this.readyTimeout;
    const elapsed = Math.floor((Date.now() - this.readyStartTime) / 1000);
    return Math.max(0, this.readyTimeout - elapsed);
  }

  _handleReadyTimeout() {
    const activePlayers = this.players.filter(p => !p.disconnected && p.chips > 0);
    const notReadyPlayers = activePlayers.filter(p => !this.readyForNext.has(p.id));
    
    if (notReadyPlayers.length > 0) {
      this._log(`准备超时，以下玩家将被移除: ${notReadyPlayers.map(p => p.name).join(', ')}`);
      
      if (this.onReadyTimeoutCallback) {
        this.onReadyTimeoutCallback(notReadyPlayers.map(p => p.id));
      }
    }
  }

  setOnReadyTimeoutCallback(callback) {
    this.onReadyTimeoutCallback = callback;
  }

  nextHand() {
    if (this.phase !== 'SHOWDOWN' && this.phase !== 'FINISHED') {
      return { error: '当前手牌尚未结束' };
    }

    // 筹码不足的玩家标记为不活跃
    const bustedPlayers = [];
    for (const p of this.players) {
      if (p.chips <= 0) {
        p.isActive = false;
        bustedPlayers.push(p);
      }
    }

    this.startNewHand();
    
    return { bustedPlayers };
  }

  // ── History ──────────────────────────────────────────────────
  
  getHistory(limit = 50) {
    return this.history.slice(-limit);
  }

  // ── State Getter ────────────────────────────────────────────
  // Filters hole cards of opponents

  getState(viewerUserId) {
    const isShowdown = this.phase === 'SHOWDOWN';
    const isFinished = this.phase === 'FINISHED';
    const isWaiting = this.phase === 'WAITING';
    
    // 判断查看者身份：是玩家还是观战者
    const isPlayer = this.players.some(p => p.id === viewerUserId);
    const isSpectator = !isPlayer && this.spectators.includes(viewerUserId);
    
    // 观战者看不到任何玩家的底牌，直到摊牌
    const canSeeHoleCards = (playerId) => {
      if (isShowdown || isFinished) return true;
      if (playerId === viewerUserId) return true;
      return false;
    };

    return {
      phase: this.phase,
      handNumber: this.handNumber,
      pot: this.pot,
      sidePots: this.sidePots, // FIX: 返回边池信息
      communityCards: this.communityCards.map(c => ({
        rank: c.rank,
        suit: c.suit,
        display: cardToString(c)
      })),
      currentBet: this.currentBet,
      currentPlayerIndex: this.currentPlayerIndex,
      dealerIndex: this.dealerIndex,
      lastAction: this.lastAction,
      isSpectator: isSpectator,
      isPlayer: isPlayer,
      maxPlayers: this.maxPlayers,
      playerCount: this.players.length,
      spectatorCount: this.spectators.length,
      turnTimeout: this.turnTimeout,
      remainingTime: this.getRemainingTime(),
      players: this.players.map((p, idx) => ({
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
        isMe: p.id === viewerUserId,
        originalIndex: idx,
        holeCards: canSeeHoleCards(p.id)
          ? p.holeCards.map(c => ({ rank: c.rank, suit: c.suit, display: cardToString(c) }))
          : p.holeCards.map(() => ({ hidden: true })),
        ...(isShowdown && !p.folded && p.isActive && this.communityCards.length === 5 ? {
          bestHand: evaluateBest([...p.holeCards, ...this.communityCards])?.name
        } : {})
      })),
      actions: this._getAvailableActions(viewerUserId),
      log: this.currentHandLog.slice(-10),
      turnTimeout: this.turnTimeout,
      remainingTime: this.getRemainingTime(),
      readyTimeout: this.readyTimeout,
      readyRemainingTime: (isShowdown || isFinished) ? this.getReadyRemainingTime() : null
    };
  }

  _getAvailableActions(userId) {
    if (this.phase === 'SHOWDOWN' || this.phase === 'FINISHED') {
      return ['nextHand'];
    }
    if (this.phase === 'WAITING') return [];

    const playerIdx = this.players.findIndex(p => p.id === userId);
    if (playerIdx === -1) return []; // 观战者无操作
    
    const player = this.players[playerIdx];
    if (!player || player.folded || player.allIn || player.disconnected) return [];
    
    // 必须是当前回合玩家才能操作
    if (playerIdx !== this.currentPlayerIndex) return [];

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
