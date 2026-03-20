// ============================================================
// Texas Hold'em Poker - Socket.IO Manager (支持观战 & 断线重连)
// ============================================================

const socketIo = require('socket.io');
const { verifyJWT } = require('./auth');
const LobbyManager = require('./lobby');
const UserModel = require('./models/user');
const ApiKeyModel = require('./models/apiKey');
const GameActionLogModel = require('./models/gameActionLog');
const logger = require('./lib/logger');

let redisCache = null;
try {
  redisCache = require('./cache/redis');
} catch (e) {
  logger.warn('redis.module_not_available', { error: e });
}

function persistGameActionLog(payload) {
  GameActionLogModel.create(payload).catch((error) => {
    logger.error('game_action_log.persist_failed', {
      roomId: payload.roomId,
      handNumber: payload.handNumber,
      eventType: payload.eventType,
      error,
    });
  });
}

async function saveChipsToDatabase(room) {
  if (!room || !room.engine) return;
  
  const engine = room.engine;
  if (engine.phase !== 'SHOWDOWN') return;
  
  for (const player of engine.players) {
    try {
      await UserModel.updateChips(player.id, player.chips);
    } catch (e) {
      logger.error('game.save_chips_failed', { userId: player.id, error: e });
    }
  }
}

function configureSockets(server) {
  const corsOrigins = process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : '*';
  
  const io = socketIo(server, {
    cors: {
      origin: corsOrigins,
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  const lobby = new LobbyManager();

  // Middleware for authentication
  io.use(async (socket, next) => {
    const { token, apiKey } = socket.handshake.auth || {};

    if (token) {
      try {
        const decoded = verifyJWT(token);
        socket.user = decoded;
        socket.authType = 'jwt';
        return next();
      } catch (err) {
        logger.warn('socket.auth.jwt_failed', { error: err });
      }
    }

    if (apiKey) {
      try {
        const validation = await ApiKeyModel.validateKey(apiKey);
        if (!validation.valid) {
          return next(new Error(validation.error || 'Authentication error'));
        }

        const permissions = Array.isArray(validation.keyData.permissions)
          ? validation.keyData.permissions
          : JSON.parse(validation.keyData.permissions || '[]');

        if (!permissions.includes('game') && !permissions.includes('write')) {
          return next(new Error('API key missing game permission'));
        }

        socket.user = {
          id: validation.keyData.userId,
          username: validation.keyData.username,
          name: validation.keyData.username,
        };
        socket.authType = 'apikey';
        socket.apiKey = validation.keyData;
        return next();
      } catch (err) {
        logger.warn('socket.auth.apikey_failed', { error: err });
      }
    }

    return next(new Error('Authentication error'));
  });

  io.on('connection', async (socket) => {
    logger.info('socket.connected', {
      socketId: socket.id,
      userId: socket.user.id,
      authType: socket.authType,
    });

    // Add to managed users
    lobby.connectedUsers.set(socket.id, { user: socket.user, socket, roomId: null, isSpectator: false });
    
    // 检查是否有断线重连
    if (redisCache) {
      try {
        const savedState = await redisCache.getUserGameState(socket.user.id);
        if (savedState && savedState.roomId) {
          const restoreResult = lobby.handleReconnect(
            socket.user,
            socket,
            savedState.roomId,
            savedState.isSpectator || false
          );

          if (restoreResult.restored) {
            const room = restoreResult.room;
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
          } else if (restoreResult.reason === 'room_not_found') {
            await redisCache.deleteUserGameState(socket.user.id);
          }
        }
      } catch (e) {
        logger.error('socket.reconnect_failed', { userId: socket.user.id, error: e });
      }
    }
    
    // Broadcast lobby stats
    io.emit('lobby:stats', { online: lobby.getOnlineCount() });

    // ── Lobby Actions ──────────────────────────────────
    
    socket.on('lobby:join', async (data = {}) => {
      const eventStart = Date.now();
      const stakeLevel = data.stakeLevel || 'medium';
      logger.info('socket.lobby_join', {
        socketId: socket.id,
        userId: socket.user.id,
        stakeLevel,
      });
      const isQueued = await lobby.joinQueue(socket.user, socket, (roomId, players, engine, isSpectator, isNewJoin) => {
        const callbackStart = Date.now();
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
        logger.info('socket.lobby_join_callback', { roomId, playerCount: players.length, isSpectator, elapsedMs: Date.now() - callbackStart });
      }, stakeLevel);
      
      logger.info('socket.lobby_join_complete', { 
        userId: socket.user.id, 
        stakeLevel, 
        result: isQueued,
        totalElapsedMs: Date.now() - eventStart 
      });
      
      // 处理返回值
      if (isQueued === true) {
        const queue = lobby.waitingQueue.get(stakeLevel);
        socket.emit('lobby:queued', { status: 'waiting', queueSize: queue?.length || 0, stakeLevel });
      } else if (isQueued && isQueued.error) {
        // 筹码不足
        socket.emit('lobby:error', isQueued);
        logger.warn('socket.lobby_join_rejected', {
          socketId: socket.id,
          userId: socket.user.id,
          stakeLevel,
          reason: isQueued.error,
        });
      }
    });

    socket.on('lobby:leave', () => {
      // 从匹配队列中移除
      lobby.leaveQueue(socket.user.id);
      socket.emit('lobby:left');
    });

    // ── 主动离开游戏 ─────────────────────────────────

    socket.on('game:leave', async () => {
      logger.info('socket.game_leave', {
        socketId: socket.id,
        userId: socket.user.id,
      });

      // 从匹配队列中也清理一下（以防万一）
      lobby.leaveQueue(socket.user.id);

      const result = lobby.leaveGame(socket.id);
      if (!result) {
        // 用户不在任何房间
        socket.emit('lobby:left');
        return;
      }

      const { roomId, room, userName, wasSpectator } = result;

      // 清除 Redis 中的重连缓存（用户主动离开，不需要重连）
      if (redisCache) {
        try {
          await redisCache.deleteUserGameState(socket.user.id);
        } catch (e) {
          logger.error('socket.clear_reconnect_cache_failed', {
            userId: socket.user.id,
            error: e,
          });
        }
      }

      // 通知房间内剩余玩家
      if (room) {
        const msg = wasSpectator
          ? `${userName} 离开了观战`
          : `${userName} 离开了牌桌`;

        for (const [sId, d] of lobby.connectedUsers.entries()) {
          if (d.roomId === roomId) {
            d.socket.emit('game:notification', { msg });
            d.socket.emit('game:state', room.engine.getState(d.user.id));
          }
        }
      }

      socket.emit('lobby:left');
      io.emit('lobby:stats', { online: lobby.getOnlineCount() });
    });

    // ── Game Actions ───────────────────────────────────

    socket.on('game:action', async ({ action, amount }) => {
      const data = lobby.connectedUsers.get(socket.id);
      if (!data || !data.roomId) return;
      
      const roomId = data.roomId;
      const room = lobby.activeGames.get(roomId);
      if (!room) return;

      const engine = room.engine;
      const stateBefore = engine.getState(socket.user.id);
      const state = engine.performAction(socket.user.id, action, amount);

      if (state.error) {
        socket.emit('game:error', state);
        logger.warn('socket.game_action_rejected', {
          roomId,
          userId: socket.user.id,
          action,
          amount: amount || null,
          error: state.error,
        });
      } else {
        persistGameActionLog({
          roomId,
          handNumber: state.handNumber,
          stakeLevel: room.stakeLevel,
          phase: state.phase,
          eventType: 'player_action',
          userId: socket.user.id,
          playerName: socket.user.username || socket.user.name,
          action,
          amount: typeof amount === 'number' ? amount : null,
          pot: state.pot,
          currentBet: state.currentBet,
          metadata: {
            previousPhase: stateBefore.phase,
            previousPot: stateBefore.pot,
            previousCurrentBet: stateBefore.currentBet,
          },
        });

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
      persistGameActionLog({
        roomId,
        handNumber: engine.handNumber,
        stakeLevel: room.stakeLevel,
        phase: engine.phase,
        eventType: 'player_ready_next_hand',
        userId: socket.user.id,
        playerName: socket.user.username || socket.user.name,
        action: 'next',
        pot: engine.pot,
        currentBet: engine.currentBet,
        metadata: result,
      });
      
      // 通知所有人准备进度
      await broadcastToRoom(io, roomId, room, lobby, 'game:readyProgress', {
        ready: result.ready,
        count: result.count,
        total: result.total,
        readyPlayers: Array.from(engine.readyForNext)
      });
      
      if (result.ready || result.needSpectatorMatch) {
        // All active players requested next hand OR need to match from spectators
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

      persistGameActionLog({
        roomId,
        handNumber: room.engine.handNumber,
        stakeLevel: room.stakeLevel,
        phase: room.engine.phase,
        eventType: 'chat_message',
        userId: socket.user.id,
        playerName: socket.user.name,
        action: 'chat',
        pot: room.engine.pot,
        currentBet: room.engine.currentBet,
        metadata: {
          text: message.text,
        },
      });
    });

    socket.on('disconnect', async () => {
      logger.info('socket.disconnected', {
        socketId: socket.id,
        userId: socket.user.id,
      });
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
                  isSpectator: false,
                  connectionState: 'disconnected',
                });
              } catch (e) {
                logger.error('socket.cache_game_state_failed', {
                  roomId: data.roomId,
                  userId: data.user.id,
                  error: e,
                });
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
