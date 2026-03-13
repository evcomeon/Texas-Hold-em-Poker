// ============================================================
// Texas Hold'em Poker - Lobby Manager
// ============================================================

const crypto = require('crypto');
const uuidv4 = crypto.randomUUID ? () => crypto.randomUUID() : () => Math.random().toString(36).substring(2) + Date.now().toString(36);
const GameEngine = require('./game/engine');

class LobbyManager {
  constructor() {
    this.connectedUsers = new Map(); // socketId -> { user, socket }
    this.waitingQueue = []; // Array of user objects
    this.activeGames = new Map(); // roomId -> { engine, players: [] }
    
    // Config
    this.PLAYERS_PER_TABLE = 2; // For testing, 2 players. Can be increased.
  }

  onDisconnect(socketId) {
    const data = this.connectedUsers.get(socketId);
    if (!data) return;

    this.connectedUsers.delete(socketId);
    
    // Remove from queue if waiting
    this.waitingQueue = this.waitingQueue.filter(u => u.id !== data.user.id);

    // If in a game, mark as disconnected/folded
    if (data.roomId) {
      const room = this.activeGames.get(data.roomId);
      if (room) {
        room.engine.handleDisconnect(data.user.id);
        // We'll notify room via the socket broadcast in socket.js
      }
    }
    
    return data;
  }

  joinQueue(user, socket, roomIdRefCb) {
    // Prevent double queueing
    if (this.waitingQueue.find(u => u.id === user.id)) return false;
    
    // Attach socket
    this.connectedUsers.set(socket.id, { user, socket, roomId: null });
    this.waitingQueue.push(user);
    
    this._checkQueue(roomIdRefCb);
    return true;
  }

  leaveQueue(userId) {
    this.waitingQueue = this.waitingQueue.filter(u => u.id !== userId);
  }

  _checkQueue(roomIdRefCb) {
    if (this.waitingQueue.length >= this.PLAYERS_PER_TABLE) {
      // Create a game
      const players = this.waitingQueue.splice(0, this.PLAYERS_PER_TABLE);
      const roomId = `room_${uuidv4()}`;
      
      const engine = new GameEngine();
      engine.createGame(players);
      
      this.activeGames.set(roomId, { engine, players });

      // Update connected users with roomId
      players.forEach(p => {
        // Find their socket entry
        for (const [sId, data] of this.connectedUsers.entries()) {
          if (data.user.id === p.id) {
            data.roomId = roomId;
            break;
          }
        }
      });

      // Callback to socket.js to handle joining io rooms and broadcasting start
      if (roomIdRefCb) {
        roomIdRefCb(roomId, players, engine);
      }
    }
  }

  getGame(roomId) {
    return this.activeGames.get(roomId)?.engine;
  }
  
  getOnlineCount() {
    return this.connectedUsers.size;
  }
}

module.exports = LobbyManager;
