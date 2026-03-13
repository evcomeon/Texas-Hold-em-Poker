// ============================================================
// Texas Hold'em Poker - Socket.IO Manager
// ============================================================

const socketIo = require('socket.io');
const { verifyJWT } = require('./auth');
const LobbyManager = require('./lobby');

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
    if (!token) return next(new Error('Authentication error'));
    
    try {
      const decoded = verifyJWT(token);
      socket.user = decoded; // Attach user payload to socket
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    // console.log(`User connected: ${socket.user.name} (${socket.id})`);
    
    // Add to managed users (not queue yet)
    lobby.connectedUsers.set(socket.id, { user: socket.user, socket, roomId: null });
    
    // Broadcast lobby stats
    io.emit('lobby:stats', { online: lobby.getOnlineCount() });

    // ── Lobby Actions ──────────────────────────────────
    
    socket.on('lobby:join', () => {
      const isQueued = lobby.joinQueue(socket.user, socket, (roomId, players, engine) => {
        // A match was found!
        players.forEach(p => {
          // Find their socket
          let pSocket = null;
          for (const [sId, data] of lobby.connectedUsers.entries()) {
            if (data.user.id === p.id) {
              pSocket = data.socket;
              break;
            }
          }
          if (pSocket) {
            pSocket.join(roomId);
            pSocket.emit('game:start', { roomId });
            // Send initial state filtered for each player
            pSocket.emit('game:state', engine.getState(p.id));
          }
        });
      });
      
      if (isQueued) {
        socket.emit('lobby:queued', { status: 'waiting', queueSize: lobby.waitingQueue.length });
        // Notify others of queue size change (optional)
      }
    });

    socket.on('lobby:leave', () => {
      lobby.leaveQueue(socket.user.id);
      socket.emit('lobby:left');
    });

    // ── Game Actions ───────────────────────────────────

    socket.on('game:action', ({ action, amount }) => {
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
        // Broadcast new state to all players in the room, filtered for each
        room.players.forEach(p => {
          let pSocket = null;
          for (const [sId, uData] of lobby.connectedUsers.entries()) {
            if (uData.user.id === p.id) {
              pSocket = uData.socket;
              break;
            }
          }
          if (pSocket) {
            pSocket.emit('game:state', engine.getState(p.id));
          }
        });
      }
    });

    socket.on('game:next', () => {
      const data = lobby.connectedUsers.get(socket.id);
      if (!data || !data.roomId) return;
      
      const roomId = data.roomId;
      const room = lobby.activeGames.get(roomId);
      if (!room) return;

      const engine = room.engine;
      const result = engine.playerRequestedNextHand(socket.user.id);
      
      if (result.ready) {
        // All active players requested next hand
        engine.nextHand();
        room.players.forEach(p => {
          let pSocket = null;
          for (const [sId, uData] of lobby.connectedUsers.entries()) {
            if (uData.user.id === p.id) {
              pSocket = uData.socket;
              break;
            }
          }
          if (pSocket) {
            pSocket.emit('game:state', engine.getState(p.id));
          }
        });
      }
    });

    socket.on('disconnect', () => {
      const data = lobby.onDisconnect(socket.id);
      if (data && data.roomId) {
        // Broadcast state update if a game was affected
        const room = lobby.activeGames.get(data.roomId);
        if (room) {
          room.players.forEach(p => {
            let pSocket = null;
            for (const [sId, uData] of lobby.connectedUsers.entries()) {
              if (uData.user.id === p.id) {
                pSocket = uData.socket;
                break;
              }
            }
            if (pSocket) {
              pSocket.emit('game:state', room.engine.getState(p.id));
              pSocket.emit('game:notification', { msg: `${data.user.name} 掉线了，自动弃牌。` });
            }
          });
        }
      }
      io.emit('lobby:stats', { online: lobby.getOnlineCount() });
    });
  });

  return io;
}

module.exports = configureSockets;
