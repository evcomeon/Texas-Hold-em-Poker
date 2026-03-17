// ============================================================
// Redis Cache Configuration with In-Memory Fallback
// ============================================================

const redis = require('redis');
require('dotenv').config();

let redisClient = null;
let isRedisConnected = false;

const memoryCache = new Map();
const memoryHash = new Map();

function cleanupMemoryCache() {
  const now = Date.now();
  for (const [key, value] of memoryCache.entries()) {
    if (value.expires && value.expires < now) {
      memoryCache.delete(key);
    }
  }
}

setInterval(cleanupMemoryCache, 60000);

redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    reconnectStrategy: (retries) => {
      if (retries > 3) {
        console.log('⚠️ Redis unavailable, using in-memory cache');
        return false;
      }
      return Math.min(retries * 100, 3000);
    },
  },
  password: process.env.REDIS_PASSWORD || undefined,
});

redisClient.on('connect', () => {
  console.log('🔴 Redis connected');
  isRedisConnected = true;
});

redisClient.on('error', () => {});

redisClient.on('end', () => {
  isRedisConnected = false;
});

async function connectRedis() {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  } catch (err) {
    console.log('⚠️ Redis unavailable, using in-memory cache');
    isRedisConnected = false;
  }
}

async function cacheSession(userId, sessionData, ttl = 3600) {
  const key = `session:${userId}`;
  if (isRedisConnected && redisClient.isOpen) {
    try {
      await redisClient.setEx(key, ttl, JSON.stringify(sessionData));
      return;
    } catch (e) {}
  }
  memoryCache.set(key, {
    data: JSON.stringify(sessionData),
    expires: Date.now() + ttl * 1000,
  });
}

async function getSession(userId) {
  const key = `session:${userId}`;
  if (isRedisConnected && redisClient.isOpen) {
    try {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (e) {}
  }
  const cached = memoryCache.get(key);
  if (cached) {
    if (cached.expires && cached.expires < Date.now()) {
      memoryCache.delete(key);
      return null;
    }
    return JSON.parse(cached.data);
  }
  return null;
}

async function deleteSession(userId) {
  const key = `session:${userId}`;
  if (isRedisConnected && redisClient.isOpen) {
    try {
      await redisClient.del(key);
      return;
    } catch (e) {}
  }
  memoryCache.delete(key);
}

async function cacheUserGameState(userId, roomId, gameState) {
  const key = `game_state:${userId}`;
  const data = { roomId, gameState, timestamp: Date.now() };
  if (isRedisConnected && redisClient.isOpen) {
    try {
      await redisClient.setEx(key, 300, JSON.stringify(data));
      return;
    } catch (e) {}
  }
  memoryCache.set(key, {
    data: JSON.stringify(data),
    expires: Date.now() + 300 * 1000,
  });
}

async function getUserGameState(userId) {
  const key = `game_state:${userId}`;
  if (isRedisConnected && redisClient.isOpen) {
    try {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (e) {}
  }
  const cached = memoryCache.get(key);
  if (cached) {
    if (cached.expires && cached.expires < Date.now()) {
      memoryCache.delete(key);
      return null;
    }
    return JSON.parse(cached.data);
  }
  return null;
}

async function deleteUserGameState(userId) {
  const key = `game_state:${userId}`;
  if (isRedisConnected && redisClient.isOpen) {
    try {
      await redisClient.del(key);
      return;
    } catch (e) {}
  }
  memoryCache.delete(key);
}

async function addOnlineUser(userId, socketId) {
  if (isRedisConnected && redisClient.isOpen) {
    try {
      await redisClient.hSet('online_users', userId, socketId);
      return;
    } catch (e) {}
  }
  memoryHash.set(`online:${userId}`, socketId);
}

async function removeOnlineUser(userId) {
  if (isRedisConnected && redisClient.isOpen) {
    try {
      await redisClient.hDel('online_users', userId);
      return;
    } catch (e) {}
  }
  memoryHash.delete(`online:${userId}`);
}

async function getOnlineUserSocketId(userId) {
  if (isRedisConnected && redisClient.isOpen) {
    try {
      return await redisClient.hGet('online_users', userId);
    } catch (e) {}
  }
  return memoryHash.get(`online:${userId}`) || null;
}

async function getOnlineCount() {
  if (isRedisConnected && redisClient.isOpen) {
    try {
      return await redisClient.hLen('online_users');
    } catch (e) {}
  }
  let count = 0;
  for (const key of memoryHash.keys()) {
    if (key.startsWith('online:')) count++;
  }
  return count;
}

module.exports = {
  redisClient,
  connectRedis,
  cacheSession,
  getSession,
  deleteSession,
  cacheUserGameState,
  getUserGameState,
  deleteUserGameState,
  addOnlineUser,
  removeOnlineUser,
  getOnlineUserSocketId,
  getOnlineCount,
  isRedisConnected: () => isRedisConnected,
};
