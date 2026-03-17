// ============================================================
// Texas Hold'em Poker - Socket.IO Manager (支持观战 & 断线重连)
// ============================================================

const socketIo = require('socket.io');
const { verifyJWT } = require('./auth');
const LobbyManager = require('./lobby');
const UserModel = require('./models/user');

let redisCache = null;
try {
  redisCache = require('./cache/redis');
} catch (e) {
  console.log('Redis cache not available');
}

async function saveChipsToDatabase(room) {
  if (!room || !room.engine) return;
  
  const engine = room.engine;
  if (engine.phase !== 'SHOWDOWN') return;
  
  for (const player of engine.players) {
    try {
      await UserModel.updateChips(player.id, player.chips);
    } catch (e) {
      console.error(`Failed to save chips for player ${player.id}:`, e);
    }
  }
}

function configureSockets(server) {
  const io = socketIo(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const lobby = new LobbyManager();

  // Middleware for authentication
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    const jwtSecret = process.env.JWT_SECRET || 'super_secret_poker_key_2026';
    console.log('[Socket Auth] Token received:', token ? token.substring(0, 50) + '...' : 'none');
    console.log('[Socket Auth] JWT_SECRET:', jwtSecret);
    if (!token) return next(new Error('Authentication error'));
    
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, jwtSecret);
      console.log('[Socket Auth] Decoded user:', decoded);
      socket.user = decoded;
      next();
    } catch (err) {
      console.log('[Socket Auth] Error:', err.message);
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket) => {
    // Add to managed users
    lobby.connectedUsers.set(socket.id, { user: socket.user, socket, roomId: null, isSpectator: false });
    
    // 检查是否有断线重连
    if (redisCache) {
      try {
        const savedState = await redisCache.getUserGameState(socket.user.id);
        if (savedState && savedState.roomId) {
          const room = lobby.activeGames.get(savedState.roomId);
          if (room) {
            // 恢复用户到房间
            lobby.connectedUsers.get(socket.id).roomId = savedState.roomId;
            lobby.connectedUsers.get(socket.id).isSpectator = savedState.isSpectator || false;
            
            socket.join(savedState.roomId);
            socket.emit('game:reconnected', { 
              roomId: savedState.roomId,
              message: '已重新连接到游戏'
            });
            socket.emit('game:state', room.engine.getState(socket.user.id));
            
            // 通知其他玩家
            await broadcastToRoom(io, savedState.roomId, room, lobby);
            
            // 清除保存的状态
            await redisCache.deleteUserGameState(socket.user.id);
          }
        }
      } catch (e) {
        console.error('Reconnect error:', e);
      }
    }
    
    // Broadcast lobby stats
    io.emit('lobby:stats', { online: lobby.getOnlineCount() });

    // ── Lobby Actions ──────────────────────────────────
    
    socket.on('lobby:join', async (data = {}) => {
      const stakeLevel = data.stakeLevel || 'medium';
      const isQueued = await lobby.joinQueue(socket.user, socket, (roomId, players, engine, isSpectator, isNewJoin) => {
        // A match was found or joined as spectator!
        players.forEach(p => {
          let pSocket = null;
          // 找到最新的 socket（roomId 匹配的）
          for (const [sId, data] of lobby.connectedUsers.entries()) {
            if (data.user.id === p.id && data.roomId === roomId) {
              pSocket = data.socket;
              break;
            }
          }
          // 如果没找到，再找任何匹配的（兼容旧逻辑）
          if (!pSocket) {
            for (const [sId, data] of lobby.connectedUsers.entries()) {
              if (data.user.id === p.id) {
                pSocket = data.socket;
                break;
              }
            }
          }
          if (pSocket) {
            pSocket.join(roomId);
            if (isSpectator) {
              pSocket.emit('game:spectator', { roomId, message: '您正在观战，下一手牌将加入游戏' });
            } else {
              pSocket.emit('game:start', { roomId });
            }
            // Send initial state filtered for each player
            pSocket.emit('game:state', engine.getState(p.id));
          }
        });
        
        // 通知房间内其他玩家有新玩家/观战者加入
        if (isNewJoin) {
          const room = lobby.getRoom(roomId);
          if (room) {
            const joinMsg = isSpectator 
              ? `${players[0].name} 开始观战` 
              : `${players[0].name} 加入了桌子 (${room.players.length}/${room.maxPlayers})`;
            
            // 通知房间内所有人（包括观战者）
            const allUserIds = [...room.players.map(p => p.id), ...room.spectators];
            allUserIds.forEach(uid => {
              // 不通知刚加入的人自己
              if (players.find(np => np.id === uid)) return;
              
              let pSocket = null;
              for (const [sId, data] of lobby.connectedUsers.entries()) {
                if (data.user.id === uid && data.roomId === roomId) {
                  pSocket = data.socket;
                  break;
                }
              }
              if (pSocket) {
                pSocket.emit('game:notification', { msg: joinMsg });
                pSocket.emit('game:state', room.engine.getState(uid));
              }
            });
          }
        }
      }, stakeLevel);
      
      // 处理返回值
      if (isQueued === true) {
        const queue = lobby.waitingQueue.get(stakeLevel);
        socket.emit('lobby:queued', { status: 'waiting', queueSize: queue?.length || 0, stakeLevel });
      } else if (isQueued && isQueued.error) {
        // 筹码不足
        socket.emit('lobby:error', isQueued);
      }
    });

    socket.on('lobby:leave', () => {
      lobby.leaveQueue(socket.user.id);
      socket.emit('lobby:left');
    });

    // ── Game Actions ───────────────────────────────────

    socket.on('game:action', async ({ action, amount }) => {
      const data = lobby.connectedUsers.get(socket.id);
      if (!data || !data.roomId) return;
      
      const roomId = data.roomId;
      const room = lobby.activeGames.get(roomId);
      if (!room) return;

      const engine = room.engine;
      const state = engine.performAction(socket.user.id, action, amount);

      if (state.error) {
        socket.emit('game:error', state);
      } else {
        // Broadcast new state to all players and spectators in the room
        await broadcastToRoom(io, roomId, room, lobby);
      }
    });

    socket.on('game:next', async () => {
      const data = lobby.connectedUsers.get(socket.id);
      if (!data || !data.roomId) {
        return;
      }
      
      const roomId = data.roomId;
      const room = lobby.activeGames.get(roomId);
      if (!room) return;

      const engine = room.engine;
      const result = engine.playerRequestedNextHand(socket.user.id);
      
      // 通知所有人准备进度
      await broadcastToRoom(io, roomId, room, lobby, 'game:readyProgress', {
        ready: result.ready,
        count: result.count,
        total: result.total,
        readyPlayers: Array.from(engine.readyForNext)
      });
      
      if (result.ready) {
        // All active players requested next hand
        // 获取盲注配置
        const stakeConfig = lobby.getStakeLevels()[room.stakeLevel || 'medium'];
        
        // 处理玩家和观战者的匹配（包括输光筹码的玩家转为观战者，有足够筹码的观战者转为玩家）
        const matchResult = await lobby.startNewHandWithSpectators(roomId, stakeConfig);
        
        // 检查是否有足够的玩家继续游戏
        if (!matchResult || !matchResult.canStart) {
          // 玩家不足，通知所有人游戏结束
          engine.phase = 'FINISHED';
          await broadcastToRoom(io, roomId, room, lobby, 'game:notification', {
            msg: '玩家不足，游戏结束。请充值后继续游戏。'
          });
          await broadcastToRoom(io, roomId, room, lobby);
          return;
        }
        
        // 重置筹码保存标志
        room.chipsSaved = false;
        
        // 开始新一手牌
        engine.nextHand();
        
        // 广播新状态
        await broadcastToRoom(io, roomId, room, lobby);
      }
    });

    // 获取游戏历史
    socket.on('game:history', () => {
      const data = lobby.connectedUsers.get(socket.id);
      if (!data || !data.roomId) return;
      
      const roomId = data.roomId;
      const room = lobby.activeGames.get(roomId);
      if (!room) return;

      const history = room.engine.getHistory(50);
      socket.emit('game:history', { history });
    });

    // 聊天消息
    socket.on('game:chat', (data) => {
      const userData = lobby.connectedUsers.get(socket.id);
      if (!userData || !userData.roomId) return;
      
      const roomId = userData.roomId;
      const room = lobby.activeGames.get(roomId);
      if (!room) return;

      const message = {
        userId: socket.user.id,
        userName: socket.user.name,
        text: data.text?.trim().slice(0, 200), // 限制200字符
        time: Date.now()
      };

      // 广播给房间内所有人
      for (const [sId, d] of lobby.connectedUsers.entries()) {
        if (d.roomId === roomId) {
          d.socket.emit('game:chat', message);
        }
      }
    });

    socket.on('disconnect', async () => {
      const data = lobby.onDisconnect(socket.id);
      if (data && data.roomId) {
        const room = lobby.activeGames.get(data.roomId);
        if (room) {
          if (data.isSpectator) {
            // 观战者离开，通知其他玩家
            room.players.forEach(p => {
              let pSocket = findSocketByUserId(p.id, data.roomId, lobby);
              if (pSocket) {
                pSocket.emit('game:notification', { msg: `${data.user.name} 离开了观战` });
              }
            });
          } else {
            // 玩家掉线，保存状态以便重连
            if (redisCache && room.engine.phase !== 'WAITING' && room.engine.phase !== 'FINISHED') {
              try {
                await redisCache.cacheUserGameState(data.user.id, data.roomId, {
                  phase: room.engine.phase,
                  isSpectator: false
                });
              } catch (e) {
                console.error('Failed to save game state:', e);
              }
            }
            
            // 广播状态更新
            await broadcastToRoom(io, data.roomId, room, lobby);
            room.players.forEach(p => {
              let pSocket = findSocketByUserId(p.id, data.roomId, lobby);
              if (pSocket) {
                pSocket.emit('game:notification', { msg: `${data.user.name} 掉线了，等待重连...` });
              }
            });
          }
        }
      }
      io.emit('lobby:stats', { online: lobby.getOnlineCount() });
    });
  });
  
  // Helper: 广播房间状态给所有玩家和观战者
  async function broadcastToRoom(io, roomId, room, lobby, eventName = 'game:state', extraData = null) {
    const allUserIds = [...room.players.map(p => p.id), ...room.spectators];
    
    // 如果游戏进入 SHOWDOWN 阶段，保存筹码到数据库并启动准备计时器
    if (room.engine.phase === 'SHOWDOWN' && !room.chipsSaved) {
      room.chipsSaved = true;
      await saveChipsToDatabase(room);
      
      // 启动准备计时器
      room.engine.startReadyTimer();
    }
    
    for (const [sId, data] of lobby.connectedUsers.entries()) {
      if (data.roomId === roomId) {
        if (eventName === 'game:state') {
          const state = room.engine.getState(data.user.id);
          // 添加准备超时时间
          if (room.engine.phase === 'SHOWDOWN' || room.engine.phase === 'FINISHED') {
            state.readyTimeout = room.engine.readyTimeout;
            state.readyRemainingTime = room.engine.getReadyRemainingTime();
          }
          data.socket.emit('game:state', state);
        } else {
          data.socket.emit(eventName, extraData);
        }
      }
    }
  }
  
  // Helper: 根据用户ID和房间ID查找socket
  function findSocketByUserId(userId, roomId, lobby) {
    for (const [sId, data] of lobby.connectedUsers.entries()) {
      if (data.user.id === userId && data.roomId === roomId) {
        return data.socket;
      }
    }
    return null;
  }

  return io;
}

module.exports = configureSockets;
