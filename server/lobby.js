// ============================================================
// Texas Hold'em Poker - Lobby Manager (支持多人一桌 & 观战)
// ============================================================

const crypto = require('crypto');
const uuidv4 = crypto.randomUUID ? () => crypto.randomUUID() : () => Math.random().toString(36).substring(2) + Date.now().toString(36);
const GameEngine = require('./game/engine');
const UserModel = require('./models/user');

class LobbyManager {
  constructor() {
    this.connectedUsers = new Map(); // socketId -> { user, socket, roomId, isSpectator }
    this.waitingQueue = new Map(); // stakeLevel -> Array of user objects
    this.activeGames = new Map(); // roomId -> { engine, players: [], spectators: [], maxPlayers: number, stakeLevel }
    
    // Config
    this.MIN_PLAYERS = 2;  // 最少2人开始游戏
    this.MAX_PLAYERS = 8;  // 最多8人一桌
    
    // 盲注级别
    this.STAKE_LEVELS = {
      low: { smallBlind: 5, bigBlind: 10, name: '低注桌' },
      medium: { smallBlind: 10, bigBlind: 20, name: '中注桌' },
      high: { smallBlind: 25, bigBlind: 50, name: '高注桌' }
    };
    
    // 初始化等待队列
    Object.keys(this.STAKE_LEVELS).forEach(level => {
      this.waitingQueue.set(level, []);
    });
  }

  getStakeLevels() {
    return this.STAKE_LEVELS;
  }

  onDisconnect(socketId) {
    const data = this.connectedUsers.get(socketId);
    if (!data) return;

    this.connectedUsers.delete(socketId);
    
    // Remove from all waiting queues
    for (const [level, queue] of this.waitingQueue.entries()) {
      this.waitingQueue.set(level, queue.filter(u => u.id !== data.user.id));
    }

    // If in a game, handle disconnect
    if (data.roomId) {
      const room = this.activeGames.get(data.roomId);
      if (room) {
        if (data.isSpectator) {
          // Remove from spectators
          room.spectators = room.spectators.filter(id => id !== data.user.id);
          room.engine.removeSpectator(data.user.id);
        } else {
          // 从玩家列表中移除（不只是标记断开）
          room.players = room.players.filter(p => p.id !== data.user.id);
          room.engine.removePlayer(data.user.id);
          
          // 如果房间空了，删除房间
          if (room.players.length === 0 && room.spectators.length === 0) {
            this.activeGames.delete(data.roomId);
          } else if (room.players.length === 1 && room.engine.phase !== 'WAITING' && room.engine.phase !== 'FINISHED') {
            // 只剩一个人，结束当前游戏
            room.engine.phase = 'FINISHED';
            this._broadcastToRoom(data.roomId, room);
          }
        }
      }
    }
    
    return data;
  }

  async joinQueue(user, socket, roomIdRefCb, stakeLevel = 'medium') {
    // 验证盲注级别
    if (!this.STAKE_LEVELS[stakeLevel]) {
      stakeLevel = 'medium';
    }
    
    // Prevent double queueing in same level
    const queue = this.waitingQueue.get(stakeLevel);
    console.log(`[Lobby] joinQueue: user ${user.id} (${user.username}), queue length before: ${queue.length}`);
    if (queue.find(u => u.id === user.id)) {
      console.log(`[Lobby] User ${user.id} already in queue`);
      return false;
    }
    
    // 检查用户是否已经在某个房间（断开重连的情况）
    const existingData = this._findUserDataById(user.id);
    if (existingData && existingData.roomId) {
      // 用户之前在某个房间，先离开那个房间
      this._leaveRoom(user.id, existingData.roomId);
    }
    
    // 先同步地将用户添加到队列（占位）
    queue.push(user);
    console.log(`[Lobby] User ${user.id} added to queue, queue length after: ${queue.length}`);
    
    // Attach socket
    this.connectedUsers.set(socket.id, { user, socket, roomId: null, isSpectator: false, stakeLevel });
    
    // 异步获取用户筹码余额并更新
    UserModel.findById(user.id).then(dbUser => {
      if (dbUser) {
        user.chips = dbUser.chips_balance;
        user.picture = dbUser.avatar_url || user.picture;
      }
    }).catch(e => {
      console.error('Failed to fetch user chips:', e);
      user.chips = user.chips || 10000;
    });
    
    // 使用 setImmediate 确保所有同步的 joinQueue 调用都完成后再检查队列
    setImmediate(() => {
      this._checkQueue(roomIdRefCb, stakeLevel);
    });
    
    return true;
  }
  
  _findUserDataById(userId) {
    for (const [sId, data] of this.connectedUsers.entries()) {
      if (data.user.id === userId) {
        return data;
      }
    }
    return null;
  }
  
  _leaveRoom(userId, roomId) {
    const room = this.activeGames.get(roomId);
    if (!room) return;
    
    // 从玩家列表中移除
    room.players = room.players.filter(p => p.id !== userId);
    room.engine.removePlayer(userId);
    
    // 从观战者列表中移除
    room.spectators = room.spectators.filter(id => id !== userId);
    
    // 更新 connectedUsers 中该用户的 roomId
    for (const [sId, data] of this.connectedUsers.entries()) {
      if (data.user.id === userId) {
        data.roomId = null;
        data.isSpectator = false;
      }
    }
    
    // 如果房间空了，删除房间
    if (room.players.length === 0 && room.spectators.length === 0) {
      this.activeGames.delete(roomId);
      // console.log(`[Lobby] 房间 ${roomId} 已删除`);
    }
  }

  leaveQueue(userId) {
    for (const [level, queue] of this.waitingQueue.entries()) {
      this.waitingQueue.set(level, queue.filter(u => u.id !== userId));
    }
  }

  getSocketByUserId(userId) {
    for (const [sId, data] of this.connectedUsers.entries()) {
      if (data.user.id === userId) {
        return data.socket;
      }
    }
    return null;
  }

  _checkQueue(roomIdRefCb, stakeLevel = 'medium') {
    const queue = this.waitingQueue.get(stakeLevel);
    const stakeConfig = this.STAKE_LEVELS[stakeLevel];
    
    console.log(`[Lobby] _checkQueue called, queue length: ${queue.length}, stakeLevel: ${stakeLevel}`);
    
    while (queue.length > 0) {
      // 先尝试找到可加入的同级别桌子
      let joined = false;
      
      for (const [roomId, room] of this.activeGames.entries()) {
        // 只加入同级别且有玩家空位的桌子
        const sameLevel = room.stakeLevel === stakeLevel;
        const canJoin = sameLevel && room.players.length < this.MAX_PLAYERS;
        
        if (canJoin) {
          const player = queue.shift();
          if (!player) break;
          
          // 判断是作为玩家加入还是观战者
          // 只有当游戏正在进行中（不是WAITING或FINISHED）时才作为观战者
          const isSpectator = room.engine.phase !== 'WAITING' && room.engine.phase !== 'FINISHED';
          
          if (isSpectator) {
            // 作为观战者加入
            room.spectators.push(player.id);
            room.engine.addSpectator(player.id);
            // 更新用户状态
            for (const [sId, data] of this.connectedUsers.entries()) {
              if (data.user.id === player.id) {
                data.roomId = roomId;
                data.isSpectator = true;
                break;
              }
            }
            
            // 通知玩家作为观战者加入
            if (roomIdRefCb) {
              roomIdRefCb(roomId, [player], room.engine, true, true);
            }
          } else {
            // 作为玩家加入（等待状态或结束后）
            room.players.push(player);
            const added = room.engine.addPlayer(player);
            
            // 更新用户状态
            for (const [sId, data] of this.connectedUsers.entries()) {
              if (data.user.id === player.id) {
                data.roomId = roomId;
                data.isSpectator = false;
                break;
              }
            }
            
            // 通知新玩家加入
            if (roomIdRefCb) {
              roomIdRefCb(roomId, [player], room.engine, false, true);
            }
            
            // addPlayer 内部已经处理了开始游戏，这里只需要广播状态
            if (room.engine.phase !== 'WAITING') {
              this._broadcastToRoom(roomId, room);
            }
          }
          
          joined = true;
          break;
        }
      }
      
      // 如果没有找到可加入的桌子，创建新桌子
      if (!joined) {
        // 只有当队列中有足够玩家时才创建新桌子
        if (queue.length < this.MIN_PLAYERS) {
          console.log(`[Lobby] 队列人数不足 (${queue.length}/${this.MIN_PLAYERS})，等待更多玩家...`);
          break;
        }
        
        // 创建同级别的新桌子，取 MIN_PLAYERS 个玩家开始游戏
        // 其他玩家会作为观战者加入
        const players = queue.splice(0, this.MIN_PLAYERS);
        if (players.length === 0) break;
        
        const roomId = `room_${uuidv4()}`;
        
        const engine = new GameEngine(stakeConfig);
        engine.createGame(players);
        
        // 设置操作超时回调
        engine.setOnTimeoutCallback((playerId, action, result) => {
          this._onPlayerTimeout(roomId, playerId, action, result);
        });
        
        // 设置准备超时回调
        engine.setOnReadyTimeoutCallback((playerIds) => {
          this._onReadyTimeout(roomId, playerIds);
        });
        
        this.activeGames.set(roomId, { 
          engine, 
          players,
          spectators: [],
          maxPlayers: this.MAX_PLAYERS,
          stakeLevel
        });

        // Update connected users with roomId
        players.forEach(p => {
          for (const [sId, data] of this.connectedUsers.entries()) {
            if (data.user.id === p.id) {
              data.roomId = roomId;
              data.isSpectator = false;
              break;
            }
          }
        });

        // Callback to socket.js to handle joining io rooms and broadcasting start
        if (roomIdRefCb) {
          roomIdRefCb(roomId, players, engine, false, false);
        }
        
        joined = true;
        
        // 将剩余队列中的玩家作为观战者加入
        const room = this.activeGames.get(roomId);
        const remainingPlayers = queue.splice(0, queue.length);
        for (const spectator of remainingPlayers) {
          room.spectators.push(spectator.id);
          engine.addSpectator(spectator.id);
          
          // 更新用户状态
          for (const [sId, data] of this.connectedUsers.entries()) {
            if (data.user.id === spectator.id) {
              data.roomId = roomId;
              data.isSpectator = true;
              break;
            }
          }
          
          // 通知观战者加入
          if (roomIdRefCb) {
            roomIdRefCb(roomId, [spectator], engine, true, true);
          }
        }
        console.log(`[Lobby] Added ${remainingPlayers.length} spectators to room ${roomId}`);
        
        // 如果只有1个人，游戏保持WAITING状态，等待第二个人加入
        // 如果已经有2人或以上，游戏会自动开始（在createGame里调用了startNewHand）
      }
    }
  }
  
  // 广播房间状态给所有玩家和观战者
  _broadcastToRoom(roomId, room) {
    const allUserIds = [...room.players.map(p => p.id), ...room.spectators];
    
    for (const [sId, data] of this.connectedUsers.entries()) {
      if (data.roomId === roomId) {
        data.socket.emit('game:state', room.engine.getState(data.user.id));
      }
    }
  }

  getGame(roomId) {
    return this.activeGames.get(roomId)?.engine;
  }
  
  getRoom(roomId) {
    return this.activeGames.get(roomId);
  }
  
  getOnlineCount() {
    return this.connectedUsers.size;
  }
  
  // 开始新的一手牌，将观战者转为玩家
  async startNewHandWithSpectators(roomId, stakeConfig) {
    const room = this.activeGames.get(roomId);
    if (!room) return { canStart: false };
    
    const minChips = stakeConfig ? stakeConfig.bigBlind : 10;
    
    // 1. 先处理输光筹码的玩家，将他们转为观战者
    const bustedPlayers = [];
    const activePlayers = [];
    for (const player of room.players) {
      // 从数据库获取最新筹码
      try {
        const dbUser = await UserModel.findById(player.id);
        if (dbUser) {
          player.chips = dbUser.chips_balance;
        }
      } catch (e) {
        console.error('Failed to fetch player chips:', e);
      }
      
      if (player.chips < minChips) {
        // 筹码不足，转为观战者
        bustedPlayers.push(player);
        room.engine.removePlayer(player.id);
        room.engine.addSpectator(player.id);
        
        // 更新状态
        for (const [sId, data] of this.connectedUsers.entries()) {
          if (data.user.id === player.id) {
            data.isSpectator = true;
            break;
          }
        }
        
        // 通知该玩家筹码不足
        const bustedSocket = this.getSocketByUserId(player.id);
        if (bustedSocket) {
          bustedSocket.emit('game:busted', {
            message: '您的筹码不足，无法继续游戏，请充值后继续',
            currentChips: player.chips || 0
          });
        }
      } else {
        activePlayers.push(player);
      }
    }
    
    // 更新房间玩家列表（移除筹码不足的玩家）
    room.players = activePlayers;
    
    // 将筹码不足的玩家加入观战者列表
    for (const busted of bustedPlayers) {
      if (!room.spectators.includes(busted.id)) {
        room.spectators.push(busted.id);
      }
    }
    
    // 2. 将有足够筹码的观战者转为玩家（如果还有空位）
    const stillSpectators = [];
    while (room.spectators.length > 0 && room.players.length < this.MAX_PLAYERS) {
      const specId = room.spectators.shift();
      room.engine.removeSpectator(specId);
      let specUser = this._findUserById(specId);
      
      if (specUser) {
        // 从数据库获取最新筹码
        try {
          const dbUser = await UserModel.findById(specId);
          if (dbUser) {
            specUser.chips = dbUser.chips_balance;
          }
        } catch (e) {
          console.error('Failed to fetch spectator chips:', e);
        }
        
        // 检查筹码是否足够
        if (specUser.chips >= minChips) {
          room.players.push(specUser);
          room.engine.addPlayer(specUser);
          
          // 更新状态
          for (const [sId, data] of this.connectedUsers.entries()) {
            if (data.user.id === specId) {
              data.isSpectator = false;
              break;
            }
          }
        } else {
          // 筹码不足，继续作为观战者
          stillSpectators.push(specId);
          room.engine.addSpectator(specId);
          
          // 通知该玩家筹码不足
          const specSocket = this.getSocketByUserId(specId);
          if (specSocket) {
            specSocket.emit('game:busted', {
              message: '您的筹码不足，无法加入游戏，请充值后继续',
              currentChips: specUser.chips || 0
            });
          }
        }
      }
    }
    
    // 恢复筹码不足的观战者
    room.spectators.push(...stillSpectators);
    
    this._log(`新一手牌开始: ${room.players.length} 名玩家, ${room.spectators.length} 名观战者`);
    
    // 检查是否有足够的玩家继续游戏
    if (room.players.length < 2) {
      this._log(`玩家不足 (${room.players.length}/2)，无法继续游戏`);
      return { canStart: false, playerCount: room.players.length };
    }
    
    return { canStart: true, playerCount: room.players.length };
  }
  
  // 处理玩家超时
  _onPlayerTimeout(roomId, playerId, action, result) {
    const room = this.activeGames.get(roomId);
    if (!room) return;
    
    // 广播超时消息
    const allUserIds = [...room.players.map(p => p.id), ...room.spectators];
    for (const [sId, data] of this.connectedUsers.entries()) {
      if (data.roomId === roomId) {
        data.socket.emit('game:timeout', {
          playerId,
          action,
          message: `玩家超时，自动${action === 'check' ? '过牌' : '弃牌'}`
        });
        data.socket.emit('game:state', room.engine.getState(data.user.id));
      }
    }
  }
  
  // 处理准备超时
  _onReadyTimeout(roomId, playerIds) {
    const room = this.activeGames.get(roomId);
    if (!room) return;
    
    console.log(`[Ready Timeout] Room ${roomId}: Players ${playerIds.join(', ')} did not ready in time`);
    
    // 将未准备的玩家标记为断开连接并移除
    for (const playerId of playerIds) {
      const player = room.players.find(p => p.id === playerId);
      if (player) {
        player.disconnected = true;
        this._log(`${player.name} 准备超时，被移除`);
      }
      
      // 通知该玩家
      for (const [sId, data] of this.connectedUsers.entries()) {
        if (data.user.id === playerId && data.roomId === roomId) {
          data.socket.emit('game:kicked', {
            reason: '准备超时，已自动退出游戏'
          });
          data.roomId = null;
          break;
        }
      }
    }
    
    // 从活跃玩家中移除超时玩家
    room.players = room.players.filter(p => !playerIds.includes(p.id));
    
    // 广播更新
    const allUserIds = [...room.players.map(p => p.id), ...room.spectators];
    for (const [sId, data] of this.connectedUsers.entries()) {
      if (data.roomId === roomId) {
        data.socket.emit('game:notification', {
          msg: `${playerIds.length} 名玩家准备超时，已被移除`
        });
        data.socket.emit('game:state', room.engine.getState(data.user.id));
      }
    }
    
    // 检查是否还有足够玩家继续游戏
    const activePlayers = room.players.filter(p => !p.disconnected && p.chips > 0);
    if (activePlayers.length < 2) {
      // 玩家不足，结束游戏
      room.engine.phase = 'FINISHED';
      for (const [sId, data] of this.connectedUsers.entries()) {
        if (data.roomId === roomId) {
          data.socket.emit('game:notification', {
            msg: '玩家不足，游戏结束'
          });
          data.socket.emit('game:state', room.engine.getState(data.user.id));
        }
      }
    } else {
      // 继续游戏，开始新一手
      room.engine.startNewHand();
      for (const [sId, data] of this.connectedUsers.entries()) {
        if (data.roomId === roomId) {
          data.socket.emit('game:state', room.engine.getState(data.user.id));
        }
      }
    }
  }
  
  _log(message) {
    console.log(`[Lobby] ${message}`);
  }
  
  _findUserById(userId) {
    for (const [sId, data] of this.connectedUsers.entries()) {
      if (data.user.id === userId) {
        return data.user;
      }
    }
    return null;
  }
}

module.exports = LobbyManager;
