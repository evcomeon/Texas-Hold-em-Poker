import { io } from 'socket.io-client';

const API_URL = process.env.API_URL || 'http://localhost:3001';

const BOT_TOKENS = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NzksInVzZXJuYW1lIjoiVGVzdEJvdDEiLCJpYXQiOjE3NzM3MTQwMjgsImV4cCI6MTgwNTI1MDAyOH0.XW8FU1KADw7VaE-R5T3aXGworan1FK2tFcV1KWs99Wk',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ODAsInVzZXJuYW1lIjoiVGVzdEJvdDIiLCJpYXQiOjE3NzM3MTQwMjgsImV4cCI6MTgwNTI1MDAyOH0.c72Zc2qj4Gw94iTRcJctFvQK_MUvVdcc6VCJZVUWFM4',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ODEsInVzZXJuYW1lIjoiVGVzdEJvdDMiLCJpYXQiOjE3NzM3MTQwMjgsImV4cCI6MTgwNTI1MDAyOH0.py9zdHb4JRiD999WYdLatAIx_dy8TlbHsq_iTDJG5FU',
];

class TestBot {
  constructor(id, token, apiUrl) {
    this.id = id;
    this.name = `Bot${id}`;
    this.token = token;
    this.apiUrl = apiUrl;
    this.socket = null;
    this.gameState = null;
    this.isConnected = false;
    this.isSpectator = false;
  }

  log(message) {
    const time = new Date().toLocaleTimeString('zh-CN');
    console.log(`[${time}] [${this.name}] ${message}`);
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
    this.socket.on('game:state', (state) => {
      this.gameState = state;
      this.isSpectator = state.isSpectator;
      this.log(`游戏状态更新: phase=${state.phase}, isSpectator=${state.isSpectator}`);
      
      if (state.isMyTurn && state.actions && state.actions.length > 0) {
        this.makeDecision(state);
      }
    });

    this.socket.on('game:start', (data) => {
      this.log(`游戏开始! 房间: ${data.roomId}`);
    });

    this.socket.on('game:notification', (data) => {
      this.log(`通知: ${data.msg}`);
    });

    this.socket.on('game:kicked', (data) => {
      this.log(`被踢出: ${data.reason}`);
    });

    this.socket.on('game:busted', (data) => {
      this.log(`筹码不足: ${data.message}`);
    });
  }

  joinQueue(stakeLevel = 'medium') {
    return new Promise((resolve) => {
      this.log(`加入队列: ${stakeLevel}`);
      this.socket.emit('lobby:join', { stakeLevel });
      setTimeout(resolve, 500);
    });
  }

  makeDecision(state) {
    if (!state.actions || state.actions.length === 0) return;
    
    const random = Math.random();
    let action, amount = 0;
    
    const canCheck = state.actions.some(a => a.type === 'check');
    const canCall = state.actions.some(a => a.type === 'call');
    const canRaise = state.actions.some(a => a.type === 'raise');
    const canFold = state.actions.some(a => a.type === 'fold');
    
    if (canCheck && random < 0.6) {
      action = 'check';
    } else if (canCall && random < 0.7) {
      action = 'call';
    } else if (canRaise && random < 0.3) {
      action = 'raise';
      amount = state.currentBet * 2;
    } else if (canFold) {
      action = 'fold';
    } else if (canCall) {
      action = 'call';
    } else if (canCheck) {
      action = 'check';
    } else {
      action = state.actions[0].type;
    }
    
    this.log(`决策: ${action} ${amount > 0 ? amount : ''}`);
    this.socket.emit('game:action', { action, amount });
  }

  sendReady() {
    if (this.gameState && 
        (this.gameState.phase === 'SHOWDOWN' || this.gameState.phase === 'FINISHED')) {
      this.log('发送准备信号');
      this.socket.emit('game:ready');
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

async function runTest() {
  console.log('=== 3-Bot 端到端测试 ===\n');
  
  const bots = [];
  for (let i = 0; i < 3; i++) {
    const bot = new TestBot(i + 1, BOT_TOKENS[i], API_URL);
    bots.push(bot);
  }
  
  console.log('连接所有 bot...');
  for (const bot of bots) {
    await bot.connect();
  }
  
  console.log('\n等待 2 秒...');
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('\n所有 bot 加入队列...');
  for (const bot of bots) {
    await bot.joinQueue('medium');
  }
  
  console.log('\n测试运行中... 按 Ctrl+C 停止');
  console.log('请在浏览器打开 http://localhost:5173 观察游戏\n');
  
  setInterval(() => {
    for (const bot of bots) {
      bot.sendReady();
    }
  }, 3000);
  
  process.on('SIGINT', () => {
    console.log('\n停止测试...');
    for (const bot of bots) {
      bot.disconnect();
    }
    process.exit(0);
  });
}

runTest().catch(console.error);
