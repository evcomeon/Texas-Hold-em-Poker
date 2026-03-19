import { io } from 'socket.io-client';

const API_URL = process.env.API_URL || 'http://localhost:3001';
const JWT_TOKEN = process.env.JWT_TOKEN || '';
const API_KEY = process.env.API_KEY || '';
const STAKE_LEVEL = process.env.STAKE_LEVEL || 'medium';

class OpenClawPokerClient {
  constructor(options = {}) {
    this.token = options.token || JWT_TOKEN;
    this.apiKey = options.apiKey || API_KEY;
    this.stakeLevel = options.stakeLevel || STAKE_LEVEL;
    this.apiUrl = options.apiUrl || API_URL;
    
    this.socket = null;
    this.playerId = null;
    this.currentRoomId = null;
    this.gameState = null;
    this.isConnected = false;
    this.isInGame = false;
    this.isSpectator = false;
    this.pendingTurnKey = null;
    this.actedTurnKey = null;
    
    this.onGameState = options.onGameState || this.defaultOnGameState;
    this.onHandEnd = options.onHandEnd || this.defaultOnHandEnd;
    this.onLog = options.onLog || this.defaultOnLog;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const auth = this.token 
        ? { token: this.token } 
        : { apiKey: this.apiKey };

      this.socket = io(this.apiUrl, {
        auth,
        transports: ['websocket', 'polling']
      });

      this.socket.on('connect', () => {
        this.isConnected = true;
        this.log('✅ 已连接到服务器');
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        this.log(`❌ 连接失败: ${error.message}`);
        reject(error);
      });

      this.socket.on('disconnect', () => {
        this.isConnected = false;
        this.isInGame = false;
        this.log('🔌 已断开连接');
      });

      this.setupEventHandlers();
    });
  }

  setupEventHandlers() {
    this.socket.on('lobby:stats', (data) => {
      this.log(`📊 大厅状态: 在线 ${data.online || 0} 人`);
    });

    this.socket.on('lobby:queued', (data) => {
      this.log(`⏳ 匹配中: 队列 ${data.queueSize || 0} 人, 级别 ${data.stakeLevel}`);
    });

    this.socket.on('game:start', (data) => {
      this.currentRoomId = data.roomId;
      this.isInGame = true;
      this.isSpectator = false;
      this.log(`🎮 游戏开始! 房间: ${data.roomId}`);
    });

    this.socket.on('game:spectator', (data) => {
      this.currentRoomId = data.roomId;
      this.isInGame = true;
      this.isSpectator = true;
      this.log(`👀 进入观战! 房间: ${data.roomId}`);
    });

    this.socket.on('game:notification', (data) => {
      this.log(`📢 ${data.msg}`);
    });

    this.socket.on('game:state', (state) => {
      this.gameState = state;
      this.onGameState(state);
    });

    this.socket.on('game:log', (log) => {
      this.log(`📜 ${log.message}`);
    });

    this.socket.on('game:hand_end', (result) => {
      this.onHandEnd(result);
    });

    this.socket.on('game:readyProgress', (data) => {
      this.log(`⏳ 准备进度: ${data.count}/${data.total}`);
      if (!data.readyPlayers.includes(this.playerId)) {
        this.log(`📢 自动准备下一手...`);
        this.requestNextHand();
      }
    });

    this.socket.on('error', (error) => {
      this.log(`⚠️ 错误: ${error.message}`);
    });

    this.socket.on('game:chat', (data) => {
      this.log(`💬 ${data.userName}: ${data.text}`);
    });
  }

  joinLobby(stakeLevel = this.stakeLevel) {
    if (!this.isConnected) {
      this.log('❌ 未连接，无法加入大厅');
      return;
    }
    this.stakeLevel = stakeLevel;
    this.socket.emit('lobby:join', { stakeLevel });
    this.log(`🚪 加入大厅 (${stakeLevel} 级别)`);
  }

  leaveLobby() {
    if (this.socket) {
      this.socket.emit('lobby:leave');
      this.log('🚪 离开大厅');
    }
  }

  sendAction(action, amount = 0) {
    if (!this.socket || !this.isMyTurn()) {
      return false;
    }

    const payload = { action };
    if (action === 'raise' && amount > 0) {
      payload.amount = amount;
    }

    this.socket.emit('game:action', payload);
    this.log(`🎯 操作: ${action}${amount ? ` ${amount}` : ''}`);
    return true;
  }

  fold() {
    return this.sendAction('fold');
  }

  check() {
    return this.sendAction('check');
  }

  call() {
    return this.sendAction('call');
  }

  raise(amount) {
    return this.sendAction('raise', amount);
  }

  allIn() {
    return this.sendAction('allin');
  }

  isMyTurn() {
    if (!this.gameState) return false;
    if (this.gameState.phase === 'WAITING' || this.gameState.phase === 'FINISHED' || this.gameState.phase === 'SHOWDOWN') return false;
    
    const me = this.getMyPlayer();
    if (!me || me.folded || me.allIn || !me.isActive) return false;
    
    const currentPlayerIdx = this.gameState.currentPlayerIndex;
    return currentPlayerIdx !== undefined && me.originalIndex === currentPlayerIdx;
  }

  getTurnKey(state = this.gameState) {
    if (!state || typeof state.handNumber !== 'number') return null;
    return `${state.handNumber}:${state.phase}:${state.currentPlayerIndex}:${state.currentBet}`;
  }

  getMyPlayer() {
    if (!this.gameState) return null;
    // 优先使用 isMe 字段
    const me = this.gameState.players.find(p => p.isMe);
    if (me) {
      this.playerId = me.id; // 更新 playerId
      return me;
    }
    // 备用：使用存储的 playerId
    if (this.playerId) {
      return this.gameState.players.find(p => p.id === this.playerId);
    }
    return null;
  }

  getMyCards() {
    const me = this.getMyPlayer();
    return me?.holeCards || null;
  }

  getMyChips() {
    const me = this.getMyPlayer();
    return me?.chips || 0;
  }

  getPot() {
    return this.gameState?.pot || 0;
  }

  getCurrentBet() {
    return this.gameState?.currentBet || 0;
  }

  getCommunityCards() {
    return this.gameState?.communityCards || [];
  }

  getPhase() {
    return this.gameState?.phase || 'WAITING';
  }

  getTimeLeft() {
    return this.gameState?.timeLeft || 0;
  }

  sendChat(message) {
    if (this.socket) {
      this.socket.emit('game:chat', { text: message });
    }
  }

  requestNextHand() {
    if (this.socket) {
      this.socket.emit('game:next');
      this.log('✅ 已准备下一手牌');
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  log(message) {
    this.onLog(message);
  }

  defaultOnLog(message) {
    const time = new Date().toLocaleTimeString('zh-CN');
    console.log(`[${time}] ${message}`);
  }

  defaultOnGameState(state) {
    this.log(`\n=== 游戏状态 ===`);
    this.log(`阶段: ${state.phase}`);
    this.log(`底池: ${state.pot}`);
    this.log(`当前下注: ${state.currentBet}`);
    this.log(`当前玩家索引: ${state.currentPlayerIndex}`);
    
    const communityDisplay = state.communityCards?.map(c => c.display || `${c.rank}${c.suit}`).join(' ') || '无';
    this.log(`公共牌: ${communityDisplay}`);
    
    const me = this.getMyPlayer();
    if (me) {
      this.log(`\n我的状态:`);
      this.log(`  ID: ${me.id}`);
      this.log(`  索引: ${me.originalIndex}`);
      this.log(`  筹码: ${me.chips}`);
      this.log(`  已下注: ${me.bet}`);
      const cardsDisplay = me.holeCards?.map(c => c.display || `${c.rank}${c.suit}`).join(' ') || '未发牌';
      this.log(`  手牌: ${cardsDisplay}`);
      this.log(`  可用操作: ${state.actions?.join(', ') || '无'}`);
    } else {
      this.log(`\n⚠️ 未找到我的玩家信息`);
    }

    if (this.isMyTurn()) {
      const turnKey = this.getTurnKey(state);
      if (turnKey && turnKey !== this.pendingTurnKey && turnKey !== this.actedTurnKey) {
        this.pendingTurnKey = turnKey;
        this.log(`\n⏰ 轮到我操作! 剩余时间: ${state.remainingTime || state.timeLeft || '?'}秒`);
        this.makeDecision(turnKey);
      }
    } else {
      this.pendingTurnKey = null;
      this.log(`\n等待其他玩家...`);
    }
  }

  defaultOnHandEnd(result) {
    this.log(`\n=== 一手牌结束 ===`);
    this.log(`公共牌: ${result.communityCards.join(' ')}`);
    result.winners.forEach(w => {
      this.log(`🏆 赢家: ${w.name || w.id}, 赢得 ${w.amount} 筹码, 牌型: ${w.hand || '未知'}`);
    });
    
    // 自动准备下一手
    setTimeout(() => {
      this.log(`📢 自动准备下一手牌...`);
      this.requestNextHand();
    }, 1000);
  }

  makeDecision(expectedTurnKey) {
    const state = this.gameState;
    if (!state || expectedTurnKey !== this.getTurnKey(state) || !this.isMyTurn()) {
      this.pendingTurnKey = null;
      this.log(`⚠️ 不是我的回合，跳过决策`);
      return;
    }
    
    const me = this.getMyPlayer();
    if (!me) {
      this.log(`⚠️ 找不到我的玩家信息`);
      return;
    }
    
    const callAmount = state.currentBet - (me.bet || 0);
    const myChips = me.chips;
    const pot = state.pot;
    const cards = me.holeCards;

    this.log(`\n🤔 AI 决策中...`);
    this.log(`  需要跟注: ${callAmount}`);
    this.log(`  我的筹码: ${myChips}`);
    this.log(`  底池: ${pot}`);

    const handStrength = this.evaluateHandStrength(cards, state.communityCards);
    this.log(`  手牌强度: ${handStrength.toFixed(2)}`);

    // 根据手牌强度决策
    if (handStrength >= 0.8) {
      if (myChips > callAmount * 3) {
        const raiseAmount = Math.min(myChips, callAmount + pot * 0.75);
        this.log(`  决策: 加注 ${raiseAmount}`);
        this.raise(raiseAmount);
      } else {
        this.log(`  决策: 全下`);
        this.allIn();
      }
    } else if (handStrength >= 0.5) {
      if (callAmount === 0) {
        this.log(`  决策: 过牌`);
        this.check();
      } else if (callAmount <= myChips * 0.3) {
        this.log(`  决策: 跟注 ${callAmount}`);
        this.call();
      } else {
        this.log(`  决策: 弃牌 (跟注太贵)`);
        this.fold();
      }
    } else if (handStrength >= 0.3) {
      if (callAmount === 0) {
        this.log(`  决策: 过牌`);
        this.check();
      } else if (callAmount <= myChips * 0.1) {
        this.log(`  决策: 跟注 ${callAmount} (便宜看牌)`);
        this.call();
      } else {
        this.log(`  决策: 弃牌`);
        this.fold();
      }
    } else {
      if (callAmount === 0) {
        this.log(`  决策: 过牌`);
        this.check();
    } else {
      this.log(`  决策: 弃牌`);
      this.fold();
    }

    this.actedTurnKey = expectedTurnKey;
    this.pendingTurnKey = null;
  }
  }

  evaluateHandStrength(holeCards, communityCards) {
    if (!holeCards || holeCards.length === 0) return 0.3;

    // 提取牌面信息
    const ranks = holeCards.map(card => card.rank || (typeof card === 'string' ? card.slice(0, -1) : ''));
    const suits = holeCards.map(card => card.suit || (typeof card === 'string' ? card.slice(-1) : ''));
    
    let strength = 0.2;
    
    if (this.isPair(ranks)) {
      strength += 0.35;
      const pairRank = this.getRankValue(ranks[0]);
      if (pairRank >= 10) strength += 0.15;
      if (pairRank >= 12) strength += 0.1;
    }
    
    if (this.isHighCard(ranks)) {
      strength += 0.15;
    }
    
    if (suits[0] === suits[1]) {
      strength += 0.1;
    }
    
    if (this.isConnectedCards(ranks)) {
      strength += 0.1;
    }
    
    if (communityCards && communityCards.length > 0) {
      const allCards = [
        ...holeCards.map(c => ({ rank: c.rank, suit: c.suit })),
        ...communityCards.map(c => ({ rank: c.rank, suit: c.suit }))
      ];
      strength += this.evaluateMadeHand(allCards);
    }
    
    return Math.min(1, strength);
  }

  isPair(ranks) {
    return ranks[0] === ranks[1];
  }

  isHighCard(ranks) {
    const highRanks = ['A', 'K', 'Q', 'J', '10'];
    return ranks.some(r => highRanks.includes(r));
  }

  isConnectedCards(ranks) {
    const values = ranks.map(r => this.getRankValue(r));
    return Math.abs(values[0] - values[1]) <= 2;
  }

  getRankValue(rank) {
    const rankValues = {
      '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
      '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
    };
    return rankValues[rank] || 0;
  }

  evaluateMadeHand(cards) {
    if (cards.length < 5) return 0;
    
    const ranks = cards.map(c => this.getRankValue(c.rank || (typeof c === 'string' ? c.slice(0, -1) : '')));
    const suits = cards.map(c => c.suit || (typeof c === 'string' ? c.slice(-1) : ''));
    
    const rankCounts = {};
    ranks.forEach(r => { if (r) rankCounts[r] = (rankCounts[r] || 0) + 1; });
    const counts = Object.values(rankCounts).sort((a, b) => b - a);
    
    const suitCounts = {};
    suits.forEach(s => { if (s) suitCounts[s] = (suitCounts[s] || 0) + 1; });
    const maxSuitCount = Math.max(...Object.values(suitCounts), 0);
    
    let bonus = 0;
    
    if (counts[0] === 4) {
      bonus = 0.5;
    } else if (counts[0] === 3 && counts[1] === 2) {
      bonus = 0.45;
    } else if (maxSuitCount >= 5) {
      bonus = 0.4;
    } else if (counts[0] === 3) {
      bonus = 0.35;
    } else if (counts[0] === 2 && counts[1] === 2) {
      bonus = 0.25;
    } else if (counts[0] === 2) {
      bonus = 0.15;
    }
    
    return bonus;
  }
}

async function main() {
  const token = process.env.JWT_TOKEN;
  const apiKey = process.env.API_KEY;
  const stakeLevel = process.env.STAKE_LEVEL || 'medium';

  if (!token && !apiKey) {
    console.error('❌ 请设置 JWT_TOKEN 或 API_KEY 环境变量');
    console.log('\n使用方法:');
    console.log('  JWT_TOKEN=your_token node index.js');
    console.log('  或');
    console.log('  API_KEY=pk_xxx node index.js');
    process.exit(1);
  }

  const client = new OpenClawPokerClient({
    token,
    apiKey,
    stakeLevel,
    onGameState: (state) => client.defaultOnGameState(state),
    onHandEnd: (result) => client.defaultOnHandEnd(result)
  });

  try {
    await client.connect();
    
    console.log('\n========================================');
    console.log('  OpenClaw Poker Client');
    console.log('  等待匹配中...');
    console.log('========================================\n');
    
    client.joinLobby();
    
    process.on('SIGINT', () => {
      console.log('\n\n正在退出...');
      client.disconnect();
      process.exit(0);
    });

  } catch (error) {
    console.error('启动失败:', error.message);
    process.exit(1);
  }
}

export { OpenClawPokerClient };
export default main;

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  main();
}
