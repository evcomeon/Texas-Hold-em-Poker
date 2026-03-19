import { io } from 'socket.io-client';
import fs from 'fs';

const API_URL = process.env.API_URL || 'http://localhost:3001';
const NUM_BOTS = 11;
const TARGET_HANDS = 100;
const LOG_FILE = '/Users/evmbp/poker-game/clients/openclaw/test-log.txt';

const BOT_TOKENS = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NzksInVzZXJuYW1lIjoiVGVzdEJvdDEiLCJpYXQiOjE3NzM3MTQwMjgsImV4cCI6MTgwNTI1MDAyOH0.XW8FU1KADw7VaE-R5T3aXGworan1FK2tFcV1KWs99Wk',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ODAsInVzZXJuYW1lIjoiVGVzdEJvdDIiLCJpYXQiOjE3NzM3MTQwMjgsImV4cCI6MTgwNTI1MDAyOH0.c72Zc2qj4Gw94iTRcJctFvQK_MUvVdcc6VCJZVUWFM4',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ODEsInVzZXJuYW1lIjoiVGVzdEJvdDMiLCJpYXQiOjE3NzM3MTQwMjgsImV4cCI6MTgwNTI1MDAyOH0.py9zdHb4JRiD999WYdLatAIx_dy8TlbHsq_iTDJG5FU',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ODIsInVzZXJuYW1lIjoiVGVzdEJvdDQiLCJpYXQiOjE3NzM3MTQwMjgsImV4cCI6MTgwNTI1MDAyOH0.CUH9Csszg4tS5YrsCTzUPRrjoZuAZlokGOq_LOLOyqo',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ODMsInVzZXJuYW1lIjoiVGVzdEJvdDUiLCJpYXQiOjE3NzM3MTQwMjgsImV4cCI6MTgwNTI1MDAyOH0.2ghKi3KrG552HG8NDZiX86ffTHLLlB8qrLz7Uia7wz4',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTQ0LCJ1c2VybmFtZSI6IlRlc3RCb3Q2IiwiaWF0IjoxNzczNzE0MDI4LCJleHAiOjE4MDUyNTAwMjh9.UkiUX4ezdOFQFOVpUcoET_LmBj7YzNcIuIoPxZUzb-Y',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTQ1LCJ1c2VybmFtZSI6IlRlc3RCb3Q3IiwiaWF0IjoxNzczNzE0MDI4LCJleHAiOjE4MDUyNTAwMjh9.X3Z8KloXXUmPBpDGPOYmkS_s9a0PC9fL4f2JP1nFhqQ',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTYzLCJ1c2VybmFtZSI6IlRlc3RCb3Q4IiwiaWF0IjoxNzczNzI4OTM0LCJleHAiOjE4MDUyNjQ5MzR9.mughynfPylBsaa4bleV0pyqkTT7GxlSSCTMzOYwvXTQ',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTY0LCJ1c2VybmFtZSI6IlRlc3RCb3Q5IiwiaWF0IjoxNzczNzI4OTM0LCJleHAiOjE4MDUyNjQ5MzR9.IuD8R0u0BoeyTS4HUWWGUFqnrOQhJLa2ijYjgpuex3U',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTY1LCJ1c2VybmFtZSI6IlRlc3RCb3QxMCIsImlhdCI6MTc3MzcyODkzNCwiZXhwIjoxODA1MjY0OTM0fQ.NTj4x8rK88_bJe1yJAlpMLnghID14w_DvJ-vHdYxFzQ',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTY2LCJ1c2VybmFtZSI6IlRlc3RCb3QxMSIsImlhdCI6MTc3MzcyODkzNCwiZXhwIjoxODA1MjY0OTM0fQ.x4mGT7aqNPssUnXxxMhfIjnXZcJcaQM3Xs3TEpD7w1w'
];

class TestBot {
  constructor(id, token, apiUrl) {
    this.id = id;
    this.name = `Bot${id}`;
    this.token = token;
    this.apiUrl = apiUrl;
    this.socket = null;
    this.playerId = null;
    this.gameState = null;
    this.isConnected = false;
    this.isSpectator = false;
    this.logMessages = [];
    this.isReady = false;
    this.lastHandNumber = 0;
    this.pendingTurnKey = null;
    this.actedTurnKey = null;
  }

  log(message) {
    const time = new Date().toLocaleTimeString('zh-CN');
    const logLine = `[${time}] [${this.name}] ${message}`;
    this.logMessages.push(logLine);
    console.log(logLine);
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = io(this.apiUrl, {
        auth: { token: this.token },
        transports: ['websocket', 'polling']
      });

      this.socket.on('connect', () => {
        this.isConnected = true;
        this.log('已连接');
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        this.log(`连接失败: ${error.message}`);
        reject(error);
      });

      this.socket.on('disconnect', () => {
        this.isConnected = false;
        this.log('断开连接');
      });

      this.setupEventHandlers();
    });
  }

  setupEventHandlers() {
    this.socket.on('lobby:stats', (data) => {
      this.log(`大厅状态: 在线 ${data.online || 0} 人`);
    });

    this.socket.on('game:start', (data) => {
      this.log(`游戏开始! 房间: ${data.roomId}`);
      this.isSpectator = false;
      this.isReady = false;
    });

    this.socket.on('game:spectator', (data) => {
      this.log(`观战模式! 房间: ${data.roomId}`);
      this.isSpectator = true;
      this.isReady = false;
    });

    this.socket.on('lobby:queued', (data) => {
      this.log(`匹配中: 队列 ${data.queueSize || 0} 人`);
    });

    this.socket.on('game:state', (state) => {
      this.gameState = state;
      // 更新观战者状态（当观战者转为玩家时）
      if (this.isSpectator !== state.isSpectator) {
        this.isSpectator = state.isSpectator;
        if (!this.isSpectator) {
          this.log('从观战者转为玩家');
          this.isReady = false;
        }
      }
      this.handleGameState(state);
    });

    this.socket.on('game:hand_end', (result) => {
      this.handleHandEnd(result);
    });

    this.socket.on('game:readyProgress', (data) => {
      this.log(`准备进度: ${data.count}/${data.total}`);
      // 观战者不发送准备信号
      if (this.isSpectator) return;
      if (!this.isReady && !data.readyPlayers.includes(this.id)) {
        this.isReady = true;
        this.log('自动准备下一手');
        this.requestNextHand();
      }
    });

    this.socket.on('game:timeout', (data) => {
      this.log(`超时: ${data.message}`);
    });

    this.socket.on('game:kicked', (data) => {
      this.log(`被踢出: ${data.reason}`);
    });

    this.socket.on('error', (error) => {
      this.log(`错误: ${error.message || JSON.stringify(error)}`);
    });
  }

  joinLobby(stakeLevel = 'medium') {
    return new Promise((resolve) => {
      if (!this.isConnected) {
        resolve();
        return;
      }
      this.socket.emit('lobby:join', { stakeLevel });
      this.log(`加入大厅 (${stakeLevel})`);
      setTimeout(resolve, 100);
    });
  }

  handleGameState(state) {
    if (this.isMyTurn(state)) {
      const turnKey = this.getTurnKey(state);
      if (turnKey && turnKey !== this.pendingTurnKey && turnKey !== this.actedTurnKey) {
        this.pendingTurnKey = turnKey;
        setTimeout(() => this.makeDecision(turnKey), 500 + Math.random() * 1000);
      }
    } else {
      this.pendingTurnKey = null;
    }
    
    // 如果是 SHOWDOWN 阶段且不是观战者，自动准备下一手
    if (state.phase === 'SHOWDOWN' && !this.isSpectator) {
      if (!this.isReady) {
        this.isReady = true;
        setTimeout(() => {
          this.log('SHOWDOWN - 自动准备下一手');
          this.requestNextHand();
        }, 500 + Math.random() * 1000);
      }
    }
    
    // 如果是新的一手（非 SHOWDOWN），重置 isReady
    if (state.phase !== 'SHOWDOWN' && state.phase !== 'WAITING' && state.phase !== 'FINISHED') {
      if (this.isReady && state.handNumber !== this.lastHandNumber) {
        this.isReady = false;
        this.lastHandNumber = state.handNumber;
      }
    }
  }

  getTurnKey(state) {
    if (!state || typeof state.handNumber !== 'number') return null;
    return `${state.handNumber}:${state.phase}:${state.currentPlayerIndex}:${state.currentBet}`;
  }

  isMyTurn(state) {
    if (!state || state.phase === 'WAITING' || state.phase === 'FINISHED' || state.phase === 'SHOWDOWN') {
      return false;
    }
    
    const me = state.players.find(p => p.isMe);
    if (!me || me.folded || me.allIn || !me.isActive) return false;
    
    const currentPlayerIdx = state.currentPlayerIndex;
    if (currentPlayerIdx !== undefined && me.originalIndex === currentPlayerIdx) {
      return true;
    }
    
    return false;
  }

  makeDecision(expectedTurnKey) {
    const state = this.gameState;
    if (!state || expectedTurnKey !== this.getTurnKey(state) || !this.isMyTurn(state)) {
      this.pendingTurnKey = null;
      return;
    }
    
    const me = state.players.find(p => p.isMe);
    if (!me) {
      this.pendingTurnKey = null;
      return;
    }
    
    const callAmount = state.currentBet - (me.bet || 0);
    const actions = state.actions || [];
    
    if (actions.length === 0) return;
    
    const random = Math.random();
    let action;
    
    if (random < 0.1 && actions.includes('raise')) {
      const raiseAmount = Math.min(me.chips, callAmount + state.pot * 0.5);
      action = 'raise';
      this.socket.emit('game:action', { action: 'raise', amount: Math.floor(raiseAmount) });
    } else if (random < 0.3 && actions.includes('allin')) {
      action = 'allin';
      this.socket.emit('game:action', { action: 'allin' });
    } else if (callAmount === 0 && actions.includes('check')) {
      action = 'check';
      this.socket.emit('game:action', { action: 'check' });
    } else if (actions.includes('call')) {
      action = 'call';
      this.socket.emit('game:action', { action: 'call' });
    } else if (actions.includes('check')) {
      action = 'check';
      this.socket.emit('game:action', { action: 'check' });
    } else {
      action = 'fold';
      this.socket.emit('game:action', { action: 'fold' });
    }
    
    this.actedTurnKey = expectedTurnKey;
    this.pendingTurnKey = null;
    this.log(`操作: ${action}`);
  }

  handleHandEnd(result) {
    const winners = result.winners.map(w => w.name || w.id).join(', ');
    this.log(`牌局结束, 赢家: ${winners}`);
    this.isReady = false;
    
    setTimeout(() => {
      this.isReady = true;
      this.requestNextHand();
    }, 1000 + Math.random() * 500);
  }

  requestNextHand() {
    if (this.socket) {
      this.socket.emit('game:next');
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

class TestRunner {
  constructor() {
    this.bots = [];
    this.handCount = 0;
    this.lastObservedHandNumber = 0;
    this.startTime = null;
    this.logs = [];
    this.isFinished = false;
  }

  log(message) {
    const time = new Date().toLocaleTimeString('zh-CN');
    const logLine = `[${time}] [Runner] ${message}`;
    this.logs.push(logLine);
    console.log(logLine);
  }

  async start() {
    this.startTime = Date.now();
    this.log(`开始测试: ${NUM_BOTS} 个机器人, 目标 ${TARGET_HANDS} 局`);
    this.log(`API: ${API_URL}`);
    
    for (let i = 0; i < NUM_BOTS; i++) {
      const bot = new TestBot(i + 1, BOT_TOKENS[i], API_URL);
      this.bots.push(bot);
    }
    
    this.log('连接所有机器人...');
    for (const bot of this.bots) {
      try {
        await bot.connect();
      } catch (err) {
        this.log(`机器人 ${bot.name} 连接失败: ${err.message}`);
        return;
      }
    }
    
    this.log('所有机器人已连接');
    
    this.log('所有机器人加入大厅...');
    await Promise.all(this.bots.map(bot => bot.joinLobby('medium')));
    
    this.log('等待匹配...');
    
    this.setupMonitoring();
    
    await this.runUntilComplete();
  }

  setupMonitoring() {
    const leadBot = this.bots[0];
    leadBot.socket.on('game:state', (state) => {
      if (!state || typeof state.handNumber !== 'number') return;

      if (this.lastObservedHandNumber === 0) {
        this.lastObservedHandNumber = state.handNumber;
        return;
      }

      if (state.handNumber > this.lastObservedHandNumber) {
        const completedHands = state.handNumber - this.lastObservedHandNumber;
        this.handCount += completedHands;
        this.lastObservedHandNumber = state.handNumber;
        this.log(`=== 第 ${this.handCount}/${TARGET_HANDS} 局完成 ===`);

        if (this.handCount >= TARGET_HANDS) {
          this.finish();
        }
      }
    });
    
    let lastStateTime = Date.now();
    for (const bot of this.bots) {
      bot.socket.on('game:state', () => {
        lastStateTime = Date.now();
      });
    }
    
    this.monitorInterval = setInterval(() => {
      if (this.isFinished) return;
      const elapsed = (Date.now() - lastStateTime) / 1000;
      if (elapsed > 30) {
        this.log(`⚠️ 可能卡住了，最后状态更新在 ${elapsed.toFixed(0)} 秒前`);
      }
    }, 30000);
  }

  async runUntilComplete() {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  finish() {
    if (this.isFinished) return;
    this.isFinished = true;
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
    
    const duration = (Date.now() - this.startTime) / 1000;
    this.log(`\n========================================`);
    this.log(`测试完成!`);
    this.log(`总局数: ${this.handCount}`);
    this.log(`总时长: ${duration.toFixed(1)} 秒`);
    this.log(`平均每局: ${(duration / this.handCount).toFixed(2)} 秒`);
    this.log(`========================================\n`);
    
    this.saveLogs();
    
    for (const bot of this.bots) {
      bot.disconnect();
    }
    
    if (this.resolvePromise) {
      this.resolvePromise();
    }
    
    process.exit(0);
  }

  saveLogs() {
    const allLogs = [];
    allLogs.push(`=== 测试日志 ===`);
    allLogs.push(`开始时间: ${new Date(this.startTime).toISOString()}`);
    allLogs.push(`机器人数量: ${NUM_BOTS}`);
    allLogs.push(`目标局数: ${TARGET_HANDS}`);
    allLogs.push(`完成局数: ${this.handCount}`);
    allLogs.push(`\n`);
    
    for (const bot of this.bots) {
      allLogs.push(`\n=== ${bot.name} 日志 ===`);
      allLogs.push(...bot.logMessages);
    }
    
    allLogs.push(`\n=== Runner 日志 ===`);
    allLogs.push(...this.logs);
    
    fs.writeFileSync(LOG_FILE, allLogs.join('\n'));
    this.log(`日志已保存到: ${LOG_FILE}`);
  }
}

async function main() {
  const runner = new TestRunner();
  
  process.on('SIGINT', () => {
    console.log('\n\n测试被中断，保存日志...');
    runner.saveLogs();
    process.exit(0);
  });
  
  await runner.start();
}

main().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
