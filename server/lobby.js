// ============================================================
// Texas Hold'em Poker - Lobby Manager (支持多人一桌 & 观战)
// ============================================================

const crypto = require('crypto');
const uuidv4 = crypto.randomUUID ? () => crypto.randomUUID() : () => Math.random().toString(36).substring(2) + Date.now().toString(36);
const GameEngine = require('./game/engine');
const UserModel = require('./models/user');
const GameActionLogModel = require('./models/gameActionLog');
const { TableInfo } = require('./models/table');
const logger = require('./lib/logger');
const config = require('./config');

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

class LobbyManager {
  constructor() {
    this.connectedUsers = new Map(); // socketId -> { user, socket, roomId, isSpectator }
    this.waitingQueue = new Map(); // stakeLevel -> Array of user objects
    this.activeGames = new Map(); // roomId -> { engine, players: [], spectators: [], maxPlayers: number, stakeLevel }
    this.tables = new Map(); // roomId -> TableInfo
    this.queueCheckTimers = new Map(); // stakeLevel -> timeout id
    this.io = null; // Socket.IO 实例，用于广播
    
    // Config
    this.MIN_PLAYERS = config.game.minPlayers;  // 最少玩家数
    this.MAX_PLAYERS = config.game.maxPlayers;  // 最多玩家数
    
    // 盲注级别
    this.STAKE_LEVELS = config.game.stakeLevels;
    
    // 初始化等待队列
    Object.keys(this.STAKE_LEVELS).forEach(level => {
      this.waitingQueue.set(level, []);
    });

    // 可选注入：Bot 插件（不 require bots 模块，由上层注入）
    this.getFillBotsProvider = null;
    this.getPlayerChips = null;
    this.broadcastDelegate = null; // 若设置，_broadcastToRoom 委托给此函数
  }

  setFillBotsProvider(fn) {
    this.getFillBotsProvider = fn;
  }

  setGetPlayerChips(fn) {
    this.getPlayerChips = fn;
  }

  setBroadcastDelegate(fn) {
    this.broadcastDelegate = fn;
  }

  setIo(io) {
    this.io = io;
  }

  getStakeLevels() {
    return this.STAKE_LEVELS;
  }

  getTables() {
    const tables = [];
    for (const [roomId, tableInfo] of this.tables.entries()) {
      tables.push(tableInfo.toJSON());
    }
    return tables;
  }

  emitTablesUpdate() {
    if (this.io) {
      this.io.emit('table:update', this.getTables());
    }
  }

  _updateTableInfo(roomId) {
    const room = this.activeGames.get(roomId);
    if (!room) {
      this.tables.delete(roomId);
      return;
    }

    let tableInfo = this.tables.get(roomId);
    if (!tableInfo) {
      tableInfo = new TableInfo(roomId, room.stakeLevel, this.STAKE_LEVELS[room.stakeLevel]);
      this.tables.set(roomId, tableInfo);
    }

    tableInfo.players = [];
    for (const p of room.engine.players) {
      tableInfo.addPlayer(p);
    }
    tableInfo.setSpectatorCount(room.spectators.length);
    tableInfo.setPhase(room.engine.phase);
  }

  onDisconnect(socketId) {
    const data = this.connectedUsers.get(socketId);
    if (!data) return;

    this.connectedUsers.delete(socketId);
    
    // Remove from all waiting queues
    for (const [level, queue] of this.waitingQueue.entries()) {
      this.waitingQueue.set(level, queue.filter(u => u.id !== data.user.id));
    }

    if (data.roomId) {
      const room = this.activeGames.get(data.roomId);
      if (room) {
        if (data.isSpectator) {
          room.spectators = room.spectators.filter(id => id !== data.user.id);
          room.engine.removeSpectator(data.user.id);
        } else {
          room.engine.handleDisconnect(data.user.id);

          const connectedPlayers = room.players.filter((p) => p.connectionState === 'online');
          if (connectedPlayers.length <= 1 && room.engine.phase !== 'WAITING' && room.engine.phase !== 'FINISHED') {
            room.engine.phase = 'FINISHED';
            this._broadcastToRoom(data.roomId, room);
          }
        }
        this._updateTableInfo(data.roomId);
        this.emitTablesUpdate();
      }
    }
    
    return data;
  }

  async joinQueue(user, socket, roomIdRefCb, stakeLevel = 'medium') {
    const startTime = Date.now();
    
    // 验证盲注级别
    if (!this.STAKE_LEVELS[stakeLevel]) {
      stakeLevel = 'medium';
    }
    
    // Prevent double queueing in same level
    const queue = this.waitingQueue.get(stakeLevel);
    logger.info('lobby.join_queue_attempt', {
      userId: user.id,
      username: user.username,
      stakeLevel,
      queueLength: queue.length,
      elapsedMs: Date.now() - startTime,
    });
    if (queue.find(u => u.id === user.id)) {
      logger.warn('lobby.already_queued', { userId: user.id, stakeLevel });
      return false;
    }
    
    // 检查用户是否已经在某个房间（断开重连的情况）
    const findStart = Date.now();
    const existingData = this._findUserDataById(user.id);
    logger.info('lobby.find_user_data', { userId: user.id, elapsedMs: Date.now() - findStart });
    
    if (existingData && existingData.roomId) {
      // 用户之前在某个房间，先离开那个房间
      this._leaveRoom(user.id, existingData.roomId);
    }

    // 在进入队列前同步最新筹码，避免余额不足的用户抢先进队后又被转成观战者
    const dbStart = Date.now();
    try {
      const dbUser = await UserModel.findById(user.id);
      if (dbUser) {
        user.chips = dbUser.chips_balance;
        user.picture = dbUser.avatar_url || user.picture;
      }
      logger.info('lobby.db_fetch_chips', { userId: user.id, elapsedMs: Date.now() - dbStart });
    } catch (e) {
      logger.error('lobby.fetch_chips_before_queue_failed', { userId: user.id, error: e, elapsedMs: Date.now() - dbStart });
    }

    const minRequiredChips = this.STAKE_LEVELS[stakeLevel].bigBlind;
    const currentChips = user.chips || 0;
    if (currentChips < minRequiredChips) {
      return {
        error: '筹码不足，无法进入该级别牌桌',
        currentChips,
        requiredChips: minRequiredChips,
        stakeLevel
      };
    }
    
    // 先同步地将用户添加到队列（占位）
    queue.push(user);
    logger.info('lobby.joined_queue', {
      userId: user.id,
      username: user.username,
      stakeLevel,
      queueLength: queue.length,
      chips: user.chips || 0,
      totalElapsedMs: Date.now() - startTime,
    });
    
    // Attach socket
    this.connectedUsers.set(socket.id, { user, socket, roomId: null, isSpectator: false, stakeLevel });
    
    this._scheduleQueueCheck(roomIdRefCb, stakeLevel);
    
    return true;
  }

  _scheduleQueueCheck(roomIdRefCb, stakeLevel) {
    if (this.queueCheckTimers.has(stakeLevel)) {
      return;
    }

    const timer = setTimeout(() => {
      this.queueCheckTimers.delete(stakeLevel);
      this._checkQueue(roomIdRefCb, stakeLevel);
    }, 500);

    this.queueCheckTimers.set(stakeLevel, timer);
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

  async joinSpecificTable(user, socket, tableId, roomIdRefCb) {
    const room = this.activeGames.get(tableId);
    
    if (!room) {
      return { success: false, error: 'table_not_found' };
    }

    const tableInfo = this.tables.get(tableId);
    if (tableInfo && tableInfo.isFull()) {
      const suggestedRoomId = await this.joinRandom(user, socket, roomIdRefCb);
      return { 
        success: false, 
        error: 'full', 
        suggestedRoomId 
      };
    }

    const existingPlayer = room.engine.players.find(p => p.id === user.id);
    if (existingPlayer) {
      return { success: false, error: 'already_in_table' };
    }

    const playerChips = user.chips || 0;
    const playerName = user.name || user.username;

    if (playerChips < room.engine.bigBlind) {
      // insufficient chips – reject join
      return { success: false, error: 'insufficient_chips' };
    }

    room.engine.addPlayer({
          connectionState: 'waiting',
      id: user.id,
      name: playerName,
      picture: user.picture,
      chips: playerChips
    });

    for (const [sId, data] of this.connectedUsers.entries()) {
      if (data.user.id === user.id) {
        data.roomId = tableId;
        data.isSpectator = false;
        break;
      }
    }

    if (roomIdRefCb) {
      roomIdRefCb(tableId, room.engine.players, room.engine, false, false);
    }

    this._updateTableInfo(tableId);
    this.emitTablesUpdate();
    this._broadcastToRoom(tableId, room);

    logger.info('lobby.join_specific_table', {
      tableId,
      userId: user.id,
      playerName,
      playerCount: room.engine.players.length
    });

    return { success: true, roomId: tableId };
  }

  async joinRandom(user, socket, roomIdRefCb, stakeLevel = 'medium') {
    let availableTables = [];
    
    for (const [roomId, tableInfo] of this.tables.entries()) {
      if (!tableInfo.isFull() && tableInfo.stakeLevel === stakeLevel) {
        availableTables.push({
          roomId,
          playerCount: tableInfo.getPlayerCount(),
          createdAt: tableInfo.createdAt
        });
      }
    }

    availableTables.sort((a, b) => {
      if (a.playerCount !== b.playerCount) {
        return b.playerCount - a.playerCount;
      }
      return a.createdAt - b.createdAt;
    });

    if (availableTables.length > 0) {
      const targetRoomId = availableTables[0].roomId;
      return this.joinSpecificTable(user, socket, targetRoomId, roomIdRefCb);
    }

    return this.joinQueue(user, socket, roomIdRefCb, stakeLevel);
  }

  /**
   * 玩家主动离开游戏房间（非掉线）
   * 与 onDisconnect 的区别：不缓存重连状态，直接清理干净
   */
  leaveGame(socketId) {
    const data = this.connectedUsers.get(socketId);
    if (!data || !data.roomId) return null;

    const roomId = data.roomId;
    const room = this.activeGames.get(roomId);
    if (!room) {
      // 房间已不存在，仅清理 connectedUsers
      data.roomId = null;
      data.isSpectator = false;
      return null;
    }

    const userName = data.user.username || data.user.name;
    const userId = data.user.id;
    const wasSpectator = data.isSpectator;

    if (wasSpectator) {
      // 观战者离开
      room.spectators = room.spectators.filter(id => id !== userId);
      room.engine.removeSpectator(userId);
      logger.info('lobby.spectator_left', { roomId, userId, userName });
    } else {
      // 玩家离开
      const engine = room.engine;
      const player = engine.players.find(p => p.id === userId);

      if (player && !player.folded && 
          engine.phase !== 'SHOWDOWN' && engine.phase !== 'FINISHED' && engine.phase !== 'WAITING') {
        // 对局进行中，先自动弃牌
        engine.performAction(userId, 'fold');
      }

      // 标记为已移除（而非掉线）
      engine.markPlayerRemoved(userId, 'left');

      // 从 readyForNext 中移除
      engine.readyForNext.delete(userId);

      logger.info('lobby.player_left_game', { roomId, userId, userName, phase: engine.phase });

      // 检查剩余在线玩家
      const connectedPlayers = engine.players.filter(
        p => p.connectionState === 'online' && p.id !== userId
      );
      if (connectedPlayers.length <= 1 && 
          engine.phase !== 'WAITING' && engine.phase !== 'FINISHED' && engine.phase !== 'SHOWDOWN') {
        // 只剩一人，游戏无法继续（不在 showdown 阶段）
        // 注意：showdown 阶段由 readyTimeout 处理
        engine.phase = 'FINISHED';
      }
    }

    // 清理该用户的房间关联
    data.roomId = null;
    data.isSpectator = false;

    // 清理：房间空了就删除
    const remainingPlayers = room.players.filter(p => p.connectionState !== 'removed');
    if (remainingPlayers.length === 0 && room.spectators.length === 0) {
      this.activeGames.delete(roomId);
      this.tables.delete(roomId);
      logger.info('lobby.room_removed', { roomId, reason: 'empty' });
    } else {
      this._updateTableInfo(roomId);
    }
    this.emitTablesUpdate();

    return { roomId, room, userName, wasSpectator };
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
    const checkStart = Date.now();
    const queue = this.waitingQueue.get(stakeLevel);
    const stakeConfig = this.STAKE_LEVELS[stakeLevel];
    
    logger.info('lobby.check_queue', {
      stakeLevel,
      queueLength: queue.length,
      activeRoomCount: Array.from(this.activeGames.values()).filter((room) => room.stakeLevel === stakeLevel).length,
    });
    
    // 1. 先把用户填进还没开打或已结束、但仍有玩家空位的同级别桌子。
    let fillCount = 0;
    while (queue.length > 0) {
      const openRoomEntry = this._findOpenPlayerRoom(stakeLevel);
      if (!openRoomEntry) break;

      const [roomId, room] = openRoomEntry;
      const player = queue.shift();
      if (!player) break;
      
      fillCount++;
      const fillStart = Date.now();

      room.players.push(player);
      room.engine.addPlayer(player);

      for (const [sId, data] of this.connectedUsers.entries()) {
        if (data.user.id === player.id) {
          data.roomId = roomId;
          data.isSpectator = false;
          break;
        }
      }

      if (roomIdRefCb) {
        roomIdRefCb(roomId, [player], room.engine, false, true);
      }

      if (room.engine.phase !== 'WAITING') {
        this._broadcastToRoom(roomId, room);
      }
      
      logger.info('lobby.fill_room', { roomId, playerId: player.id, elapsedMs: Date.now() - fillStart });
    }

    // 2. 只要队列里有人，就持续创建新桌（不足时由可选 fillBotsProvider 补足）
    let createCount = 0;
    while (queue.length >= 1) {
      const createStart = Date.now();
      const humanCount = Math.min(queue.length, this.MAX_PLAYERS);
      const players = queue.splice(0, humanCount);
      if (players.length === 0) break;

      const fillBots = this.getFillBotsProvider ? this.getFillBotsProvider(players.length, stakeConfig) : [];
      const allPlayers = [...players, ...fillBots];
      if (allPlayers.length < this.MIN_PLAYERS) {
        queue.unshift(...players);
        break;
      }

      const roomId = this._createRoomWithPlayers(allPlayers, stakeLevel, stakeConfig, roomIdRefCb);
      createCount++;
      logger.info('lobby.room_created', {
        roomId,
        stakeLevel,
        playerCount: allPlayers.length,
        humanCount: players.length,
        botCount: fillBots.length,
        elapsedMs: Date.now() - createStart,
      });
    }

    // 3. 剩下不足开新桌的零散用户，如果有进行中的同级别桌子，则进入观战等待下一手补位。
    while (queue.length > 0) {
      const spectatorRoomEntry = this._findSpectatorRoom(stakeLevel);
      if (!spectatorRoomEntry) {
        logger.info('lobby.waiting_for_more_players', {
          stakeLevel,
          queueLength: queue.length,
          minPlayers: this.MIN_PLAYERS,
        });
        break;
      }

      const [roomId, room] = spectatorRoomEntry;
      const spectator = queue.shift();
      if (!spectator) break;

      room.spectators.push(spectator.id);
      room.engine.addSpectator(spectator.id);

      for (const [sId, data] of this.connectedUsers.entries()) {
        if (data.user.id === spectator.id) {
          data.roomId = roomId;
          data.isSpectator = true;
          break;
        }
      }

      if (roomIdRefCb) {
        roomIdRefCb(roomId, [spectator], room.engine, true, true);
      }
    }
  }

  _findOpenPlayerRoom(stakeLevel) {
    for (const entry of this.activeGames.entries()) {
      const [, room] = entry;
      const sameLevel = room.stakeLevel === stakeLevel;
      const canSeatPlayers = room.players.length < this.MAX_PLAYERS;
      const acceptsPlayers = room.engine.phase === 'WAITING' || room.engine.phase === 'FINISHED';

      if (sameLevel && canSeatPlayers && acceptsPlayers) {
        return entry;
      }
    }
    return null;
  }

  _findSpectatorRoom(stakeLevel) {
    for (const entry of this.activeGames.entries()) {
      const [, room] = entry;
      const sameLevel = room.stakeLevel === stakeLevel;
      const hasSpaceEventually = room.players.length < this.MAX_PLAYERS;
      const inProgress = room.engine.phase !== 'WAITING' && room.engine.phase !== 'FINISHED';

      if (sameLevel && hasSpaceEventually && inProgress) {
        return entry;
      }
    }
    return null;
  }

  _createRoomWithPlayers(players, stakeLevel, stakeConfig, roomIdRefCb) {
    const roomId = `room_${uuidv4()}`;
    const engine = new GameEngine(stakeConfig);
    engine.createGame(players);

    engine.setOnTimeoutCallback((playerId, action, result) => {
      this._onPlayerTimeout(roomId, playerId, action, result);
    });

    engine.setOnReadyTimeoutCallback((playerIds) => {
      this._onReadyTimeout(roomId, playerIds);
    });

    engine.setOnDisconnectTimeoutCallback((playerId) => {
      this._onDisconnectTimeout(roomId, playerId);
    });

    engine.setOnEventCallback((event) => {
      logger.info('game.engine_event', {
        roomId,
        stakeLevel,
        ...event,
      });

      persistGameActionLog({
        roomId,
        handNumber: event.handNumber,
        stakeLevel,
        phase: event.phase,
        eventType: event.eventType,
        userId: event.userId || null,
        playerName: event.playerName || null,
        action: event.action || null,
        amount: typeof event.amount === 'number' ? event.amount : null,
        pot: typeof event.pot === 'number' ? event.pot : null,
        currentBet: typeof event.currentBet === 'number' ? event.currentBet : null,
        metadata: event.metadata || {
          communityCards: event.communityCards || [],
          dealerUserId: event.dealerUserId,
          dealerName: event.dealerName,
          smallBlindUserId: event.smallBlindUserId,
          bigBlindUserId: event.bigBlindUserId,
          winners: event.winners,
          results: event.results,
          playerSnapshot: event.playerSnapshot,
        },
      });
    });

    this.activeGames.set(roomId, {
      engine,
      players,
      spectators: [],
      maxPlayers: this.MAX_PLAYERS,
      stakeLevel
    });

    players.forEach((p) => {
      for (const [sId, data] of this.connectedUsers.entries()) {
        if (data.user.id === p.id) {
          data.roomId = roomId;
          data.isSpectator = false;
          break;
        }
      }
    });

    if (roomIdRefCb) {
      roomIdRefCb(roomId, players, engine, false, false);
    }

    this._updateTableInfo(roomId);
    this.emitTablesUpdate();

    const room = this.activeGames.get(roomId);
    this._broadcastToRoom(roomId, room);

    return roomId;
  }
  
  // 广播房间状态给所有玩家和观战者
  _broadcastToRoom(roomId, room) {
    if (this.broadcastDelegate) {
      this.broadcastDelegate(roomId, room);
      return;
    }
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

  handleReconnect(user, socket, roomId, isSpectator = false) {
    this.connectedUsers.set(socket.id, {
      user,
      socket,
      roomId,
      isSpectator,
      stakeLevel: null,
    });

    const room = this.activeGames.get(roomId);
    if (!room) {
      return { restored: false, reason: 'room_not_found' };
    }

    if (isSpectator) {
      if (!room.spectators.includes(user.id)) {
        room.spectators.push(user.id);
        room.engine.addSpectator(user.id);
      }
      return { restored: true, room };
    }

    const restored = room.engine.handleReconnect(user.id);
    if (!restored) {
      return { restored: false, reason: 'player_not_found' };
    }

    const player = room.players.find((p) => p.id === user.id);
    if (player) {
      player.disconnected = false;
      player.connectionState = 'online';
    }

    return { restored: true, room };
  }
  
  // 开始新的一手牌，将观战者转为玩家
  async startNewHandWithSpectators(roomId, stakeConfig) {
    const room = this.activeGames.get(roomId);
    if (!room) return { canStart: false };
    
    const minChips = stakeConfig ? stakeConfig.bigBlind : 10;
    
    const bustedPlayers = [];
    const activePlayers = [];
    for (const player of room.players) {
      const memChips = this.getPlayerChips ? this.getPlayerChips(player) : null;
      if (memChips !== null) {
        player.chips = memChips;
      } else {
        try {
          const dbUser = await UserModel.findById(player.id);
          if (dbUser) {
            player.chips = dbUser.chips_balance;
          }
        } catch (e) {
          logger.error('lobby.fetch_player_chips_failed', { roomId, userId: player.id, error: e });
        }
      }

      if (player.chips < minChips && player.connectionState !== 'removed') {
        bustedPlayers.push(player);
        room.engine.markPlayerRemoved(player.id, 'busted');
        if (typeof player.id !== 'number' || player.id >= 0) {
          room.engine.addSpectator(player.id);
        }
        
        for (const [sId, data] of this.connectedUsers.entries()) {
          if (data.user.id === player.id) {
            data.isSpectator = true;
            break;
          }
        }
        
        const bustedSocket = this.getSocketByUserId(player.id);
        if (bustedSocket) {
          bustedSocket.emit('game:busted', {
            message: '您的筹码不足，无法继续游戏，请充值后继续',
            currentChips: player.chips || 0
          });
        }
      } else if (player.connectionState !== 'removed') {
        activePlayers.push(player);
      }
    }
    
    for (const busted of bustedPlayers) {
      if (typeof busted.id === 'number' && busted.id < 0) {
        // Bot 爆仓后直接退出，不进入观战列表
        continue;
      }
      if (!room.spectators.includes(busted.id)) {
        room.spectators.push(busted.id);
      }
    }

    const bustedBotIds = bustedPlayers
      .filter((player) => typeof player.id === 'number' && player.id < 0)
      .map((player) => player.id);
    if (bustedBotIds.length > 0) {
      // Bot 账号直接离桌，避免继续占用房间玩家位
      room.players = room.players.filter((player) => !bustedBotIds.includes(player.id));
    }
    
    // 2. 将有足够筹码的观战者转为玩家（如果还有空位）
    const stillSpectators = [];
    this._log(`处理观战者: ${room.spectators.length} 人, 当前玩家: ${room.players.length}/${this.MAX_PLAYERS}`);
    
    while (room.spectators.length > 0 && room.players.length < this.MAX_PLAYERS) {
      const specId = room.spectators.shift();
      room.engine.removeSpectator(specId);
      let specUser = this._findUserById(specId);
      
      this._log(`检查观战者 ${specId}: 用户数据 ${specUser ? '存在' : '不存在'}`);
      
      if (specUser) {
        // 从数据库获取最新筹码
        try {
          const dbUser = await UserModel.findById(specId);
          if (dbUser) {
            specUser.chips = dbUser.chips_balance;
            this._log(`观战者 ${specId} 筹码: ${specUser.chips}, 最低要求: ${minChips}`);
          }
        } catch (e) {
          logger.error('lobby.fetch_spectator_chips_failed', { roomId, userId: specId, error: e });
        }
        
        // 检查筹码是否足够
        if (specUser.chips >= minChips) {
          room.players.push(specUser);
          room.engine.addPlayer(specUser);
          this._log(`观战者 ${specId} 转为玩家`);
          
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
    
    const activePlayerCount = room.players.filter(p => p.connectionState !== 'removed').length;
    if (activePlayerCount < 2) {
      this._log(`玩家不足 (${activePlayerCount}/2)，无法继续游戏`);
      return { canStart: false, playerCount: activePlayerCount };
    }
    
    return { canStart: true, playerCount: activePlayerCount };
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
    
    logger.warn('lobby.ready_timeout', { roomId, playerIds });
    
    for (const playerId of playerIds) {
      room.engine.markPlayerRemoved(playerId, 'ready_timeout');
      
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
    
    const allUserIds = [...room.players.map(p => p.id), ...room.spectators];
    for (const [sId, data] of this.connectedUsers.entries()) {
      if (data.roomId === roomId) {
        data.socket.emit('game:notification', {
          msg: `${playerIds.length} 名玩家准备超时，已被移除`
        });
        data.socket.emit('game:state', room.engine.getState(data.user.id));
      }
    }
    
    room.engine.cleanupRemovedPlayers();
    
    const activePlayers = room.players.filter(p => p.connectionState !== 'removed' && p.chips > 0);
    if (activePlayers.length < 2) {
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
      room.engine.readyForNext.clear();
      for (const p of activePlayers) {
        room.engine.readyForNext.add(p.id);
      }
      
      room.engine.clearReadyTimer();
      room.engine.startNewHand();
      
      for (const [sId, data] of this.connectedUsers.entries()) {
        if (data.roomId === roomId) {
          data.socket.emit('game:notification', {
            msg: '准备超时玩家已移除，新一手牌开始'
          });
          data.socket.emit('game:state', room.engine.getState(data.user.id));
        }
      }
    }
  }
  
  _onDisconnectTimeout(roomId, playerId) {
    const room = this.activeGames.get(roomId);
    if (!room) return;
    
    logger.warn('lobby.disconnect_timeout', { roomId, playerId });
    
    const player = room.engine.players.find(p => p.id === playerId);
    if (!player) return;
    
    for (const [sId, data] of this.connectedUsers.entries()) {
      if (data.roomId === roomId) {
        data.socket.emit('game:notification', {
          msg: `${player.name} 掉线超时，已被移除`
        });
        data.socket.emit('game:state', room.engine.getState(data.user.id));
      }
    }
    
    const activePlayers = room.engine.players.filter(p => p.connectionState !== 'removed' && p.chips > 0);
    if (activePlayers.length < 2) {
      room.engine.phase = 'FINISHED';
      for (const [sId, data] of this.connectedUsers.entries()) {
        if (data.roomId === roomId) {
          data.socket.emit('game:notification', {
            msg: '玩家不足，游戏结束'
          });
          data.socket.emit('game:state', room.engine.getState(data.user.id));
        }
      }
    }
  }
  
  _log(message) {
    logger.info('lobby.debug', { message });
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
