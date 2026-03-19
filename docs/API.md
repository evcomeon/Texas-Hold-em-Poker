# Texas Hold'em Poker - API 文档

## 概述

本文档描述了德州扑克游戏的完整 API，包括 REST API 和 WebSocket API。

### 基础信息

| 项目 | 值 |
|------|-----|
| Base URL | `http://localhost:3001/api` |
| WebSocket | `ws://localhost:3001/socket.io/` |
| 协议 | HTTP/1.1, WebSocket |
| 数据格式 | JSON |
| 字符编码 | UTF-8 |

---

## 认证方式

API 支持两种认证方式：

### 1. JWT Token（推荐用于用户操作）

```
Authorization: Bearer <jwt_token>
```

- 有效期：1 年
- 获取方式：通过登录接口获取

### 2. API Key（推荐用于程序/Bot 接入）

```
Authorization: ApiKey <api_key>
```

- 格式：`pk_` 开头的 64 位十六进制字符串
- 权限：`read`（只读）、`write`（读写）、`game`（游戏操作）
- 有效期：可设置，默认永不过期

---

## REST API

### 一、认证接口

#### 1.1 用户注册

```
POST /api/auth/register
```

**Request Body:**
```json
{
  "username": "player1",
  "email": "player1@example.com",
  "password": "password123"
}
```

**Response (201):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "username": "player1",
    "email": "player1@example.com",
    "chipsBalance": 10000,
    "level": 1
  }
}
```

#### 1.2 用户登录

```
POST /api/auth/login
```

**Request Body:**
```json
{
  "username": "player1",
  "password": "password123"
}
```

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "username": "player1",
    "chipsBalance": 10000,
    "level": 1
  }
}
```

#### 1.3 游客登录

```
POST /api/auth/guest
```

**Request Body:**
```json
{
  "name": "Guest123"
}
```

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 2,
    "username": "Guest123",
    "chipsBalance": 10000,
    "isGuest": true
  }
}
```

#### 1.4 Google 登录

```
POST /api/auth/google
```

**Request Body:**
```json
{
  "credential": "google_id_token_here"
}
```

#### 1.5 钱包登录

```
POST /api/auth/wallet/nonce
```

**Request Body:**
```json
{
  "address": "0xf0fc3c594ea2cccdb1a55f95e1f99f18262d29e3"
}
```

**Response (200):**
```json
{
  "nonce": "276cafeb26d3ff24d93519405432da922dd8183e9136a958586300991780df68"
}
```

```
POST /api/auth/wallet/verify
```

**Request Body:**
```json
{
  "address": "0xf0fc3c594ea2cccdb1a55f95e1f99f18262d29e3",
  "signature": "0xafa914d34fe66cd9bb94aec641cebd11ec748444..."
}
```

---

### 二、API Key 管理

#### 2.1 获取 API Key 列表

```
GET /api/keys
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "keys": [
    {
      "id": 1,
      "key_prefix": "pk_a1b2c3",
      "name": "My Bot",
      "description": "AI player bot",
      "permissions": ["read", "game"],
      "rate_limit": 100,
      "is_active": true,
      "last_used_at": "2024-01-15T10:30:00Z",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### 2.2 创建 API Key

```
POST /api/keys
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "name": "My Bot",
  "description": "AI player bot for automated testing",
  "permissions": ["read", "game"],
  "rateLimit": 100,
  "expiresInDays": 365
}
```

**Response (201):**
```json
{
  "message": "API key created. Save the key now - it will not be shown again!",
  "key": "pk_a1b2c3d4e5f6...",
  "id": 1,
  "name": "My Bot",
  "permissions": ["read", "game"],
  "expiresAt": "2025-01-01T00:00:00Z"
}
```

#### 2.3 删除 API Key

```
DELETE /api/keys/:id
Authorization: Bearer <jwt_token>
```

---

### 三、用户信息

#### 3.1 获取当前用户信息

```
GET /api/auth/me
Authorization: Bearer <jwt_token> | ApiKey <api_key>
```

**Response (200):**
```json
{
  "id": 1,
  "username": "player1",
  "email": "player1@example.com",
  "chipsBalance": 15000,
  "level": 3,
  "totalGames": 50,
  "wins": 25,
  "winRate": 50.0
}
```

#### 3.2 获取用户统计

```
GET /api/auth/stats
Authorization: Bearer <jwt_token>
```

---

### 四、排行榜

#### 4.1 筹码榜

```
GET /api/leaderboard/chips?limit=50
```

**Response (200):**
```json
{
  "type": "chips",
  "leaderboard": [
    {
      "rank": 1,
      "id": 1,
      "username": "HighRoller",
      "chips": 1000000,
      "level": 50,
      "totalGames": 500,
      "winRate": 55.5
    }
  ]
}
```

#### 4.2 胜率榜

```
GET /api/leaderboard/winrate?limit=50
```

**Response (200):**
```json
{
  "type": "winrate",
  "leaderboard": [
    {
      "rank": 1,
      "id": 5,
      "username": "ProPlayer",
      "winRate": 75.5,
      "totalGames": 200,
      "wins": 151
    }
  ]
}
```

---

### 五、钱包绑定

#### 5.1 查询绑定状态

```
GET /api/wallet/bind/status
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "isBound": true,
  "wallet": {
    "address": "0xf0fc3c594ea2cccdb1a55f95e1f99f18262d29e3",
    "walletType": "metamask",
    "boundAt": "2024-01-15T10:00:00Z",
    "shortAddress": "0xf0fc...29e3"
  }
}
```

#### 5.2 获取绑定 Nonce

```
POST /api/wallet/bind/nonce
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "address": "0xf0fc3c594ea2cccdb1a55f95e1f99f18262d29e3"
}
```

**Response (200):**
```json
{
  "nonce": "0x276cafeb26d3ff24...",
  "message": "请使用钱包签名此消息以完成绑定",
  "expiresIn": 300
}
```

#### 5.3 验证并绑定

```
POST /api/wallet/bind/verify
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "address": "0xf0fc3c594ea2cccdb1a55f95e1f99f18262d29e3",
  "signature": "0xafa914d34fe66cd9...",
  "walletType": "metamask"
}
```

---

### 六、充值系统

#### 6.1 获取充值信息

```
GET /api/recharge/info
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "isWalletBound": true,
  "depositAddress": "0x1234...",
  "rate": 10000,
  "minAmount": 1,
  "supportedTokens": ["USDT", "USDC"]
}
```

#### 6.2 创建充值订单

```
POST /api/recharge/order
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "tokenSymbol": "USDT",
  "tokenAmount": 10
}
```

**Response (201):**
```json
{
  "orderNo": "ORD20240115001",
  "depositAddress": "0x1234...",
  "tokenSymbol": "USDT",
  "tokenAmount": 10,
  "chipsAmount": 100000,
  "status": "pending",
  "expiresAt": "2024-01-15T11:00:00Z"
}
```

#### 6.3 查询订单状态

```
GET /api/recharge/order/:orderNo
Authorization: Bearer <jwt_token>
```

#### 6.4 充值记录

```
GET /api/recharge/history
Authorization: Bearer <jwt_token>
```

---

## WebSocket API

### 连接

```javascript
const socket = io('http://localhost:3001', {
  auth: { token: '<jwt_token>' }
  // 或使用 API Key
  // auth: { apiKey: '<api_key>' }
});
```

### 玩家连接状态模型

服务器使用统一的连接状态模型：

| 状态 | 值 | 说明 |
|------|-----|------|
| ONLINE | `online` | 玩家在线，可以正常游戏 |
| DISCONNECTED | `disconnected` | 玩家掉线，可以重连恢复 |
| REMOVED | `removed` | 玩家已被移除，不可重连 |

**状态转换：**
- `ONLINE` → `DISCONNECTED`: 玩家掉线
- `DISCONNECTED` → `ONLINE`: 玩家重连成功
- `DISCONNECTED` → `REMOVED`: 准备超时/被踢出
- `ONLINE` → `REMOVED`: 主动离开/筹码不足(Busted)

---

### 客户端事件（Client → Server）

#### 加入大厅/队列

```javascript
socket.emit('lobby:join', {
  stakeLevel: 'medium'  // 'low' | 'medium' | 'high'
});
```

**响应事件:**
- `lobby:queued` - 已进入等待队列
- `lobby:error` - 加入失败（如筹码不足）
- `game:start` - 匹配成功，游戏开始
- `game:spectator` - 作为观战者加入（人数已满时）

#### 离开大厅/队列

```javascript
socket.emit('lobby:leave');
```

**响应事件:**
- `lobby:left` - 已离开队列

#### 游戏操作

```javascript
socket.emit('game:action', {
  action: 'call',    // 'fold' | 'check' | 'call' | 'raise' | 'allin'
  amount: 100        // 仅 raise 时需要
});
```

**响应事件:**
- `game:state` - 更新后的游戏状态
- `game:error` - 操作失败

#### 准备下一手牌

```javascript
socket.emit('game:next');
```

**响应事件:**
- `game:readyProgress` - 准备进度更新
- `game:start` - 新一手牌开始
- `game:notification` - 通知消息（如玩家不足）

#### 发送聊天消息

```javascript
socket.emit('game:chat', {
  text: 'Hello everyone!'
});
```

**响应事件:**
- `game:chat` - 广播给房间内所有人

#### 获取游戏历史

```javascript
socket.emit('game:history');
```

**响应事件:**
- `game:history` - 返回最近50条游戏记录

---

### 服务端事件（Server → Client）

#### 大厅状态更新

```javascript
socket.on('lobby:stats', (data) => {
  // data = { online: 50 }
});
```

#### 已进入队列

```javascript
socket.on('lobby:queued', (data) => {
  // data = { status: 'waiting', queueSize: 3, stakeLevel: 'medium' }
});
```

#### 游戏开始

```javascript
socket.on('game:start', (data) => {
  // data = { roomId: 'room_xxx' }
});
```

#### 观战模式

```javascript
socket.on('game:spectator', (data) => {
  // data = { roomId: 'room_xxx', message: '您正在观战，下一手牌将加入游戏' }
});
```

#### 游戏状态更新（核心）

```javascript
socket.on('game:state', (state) => {
  /*
  state = {
    phase: 'PRE_FLOP',      // 'WAITING' | 'PRE_FLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN' | 'FINISHED'
    handNumber: 1,
    communityCards: [
      { rank: 'A', suit: 'spades', display: 'A♠' }
    ],
    pot: 30,
    currentBet: 20,
    currentPlayerIndex: 2,   // 当前轮到哪位玩家
    dealerIndex: 0,          // 庄家位置
    isSpectator: false,      // 是否为观战者
    isPlayer: true,          // 是否为玩家
    isMyTurn: false,         // 是否轮到自己操作
    maxPlayers: 8,
    playerCount: 3,
    spectatorCount: 0,
    turnTimeout: 30,         // 每回合超时时间（秒）
    remainingTime: 25,       // 当前回合剩余时间
    readyTimeout: 30,        // 准备阶段超时时间
    readyRemainingTime: null,// 准备阶段剩余时间
    players: [
      {
        id: 79,
        name: 'TestBot1',
        picture: null,
        chips: 10000,
        bet: 10,
        totalBet: 10,
        folded: false,
        allIn: false,
        isDealer: true,
        isActive: true,
        disconnected: false,
        connectionState: 'online',  // 'online' | 'disconnected' | 'removed'
        isMe: false,
        originalIndex: 0,
        holeCards: [{ hidden: true }, { hidden: true }],  // 别人的牌隐藏
        bestHand: '一对'  // 仅在 SHOWDOWN 且未弃牌时显示
      }
    ],
    actions: ['fold', 'call', 'raise', 'allin'],  // 当前可执行的操作
    log: ['[12:34:56] TestBot1 跟注 10']
  }
  */
});
```

#### 准备进度更新

```javascript
socket.on('game:readyProgress', (data) => {
  /*
  data = {
    ready: false,      // 是否所有人都已准备
    count: 2,          // 已准备人数
    total: 3,          // 总活跃玩家数
    readyPlayers: [79, 80]  // 已准备的玩家ID列表
  }
  */
});
```

#### 游戏通知

```javascript
socket.on('game:notification', (data) => {
  // data = { msg: 'TestBot1 加入了桌子 (3/8)' }
});
```

#### 聊天消息

```javascript
socket.on('game:chat', (message) => {
  /*
  message = {
    userId: 79,
    userName: 'TestBot1',
    text: 'Hello!',
    time: 1712345678901
  }
  */
});
```

#### 被踢出游戏

```javascript
socket.on('game:kicked', (data) => {
  // data = { reason: '准备超时，已自动退出游戏' }
});
```

#### 筹码不足（Busted）

```javascript
socket.on('game:busted', (data) => {
  // data = { message: '您的筹码不足，无法继续游戏，请充值后继续', currentChips: 0 }
});
```

#### 重连成功

```javascript
socket.on('game:reconnected', (data) => {
  // data = { message: '已重连到游戏', roomId: 'room_xxx' }
});
```

#### 游戏历史记录

```javascript
socket.on('game:history', (data) => {
  /*
  data = {
    history: [
      { time: '12:34:56', message: 'TestBot1 加注 100' }
    ]
  }
  */
});
```

---

## 游戏流程示例

### 1. 完整游戏流程

```javascript
const socket = io('http://localhost:3001', {
  auth: { token: '<jwt_token>' }
});

// 1. 加入队列
socket.emit('lobby:join', { stakeLevel: 'medium' });

// 2. 等待匹配成功
socket.on('game:start', (data) => {
  console.log('游戏开始!', data.roomId);
});

// 3. 接收游戏状态并做出决策
socket.on('game:state', (state) => {
  if (state.isMyTurn) {
    // 根据状态做出决策
    const action = decideAction(state);
    socket.emit('game:action', { action: action.type, amount: action.amount });
  }
});

// 4. 一手牌结束，准备下一手
socket.on('game:state', (state) => {
  if (state.phase === 'SHOWDOWN' || state.phase === 'FINISHED') {
    socket.emit('game:next');  // 发送准备信号
  }
});

// 5. 接收准备进度
socket.on('game:readyProgress', (data) => {
  console.log(`准备进度: ${data.count}/${data.total}`);
});
```

### 2. Bot 决策示例

```javascript
function decideAction(state) {
  const actions = state.actions;
  const player = state.players.find(p => p.isMe);
  
  // 简单策略：能跟注就跟注，不能就跟注就弃牌
  if (actions.includes('call')) {
    return { type: 'call', amount: 0 };
  }
  if (actions.includes('check')) {
    return { type: 'check', amount: 0 };
  }
  return { type: 'fold', amount: 0 };
}
```

---

## 错误码

| 错误码 | 说明 |
|--------|------|
| `AUTH_REQUIRED` | 需要认证 |
| `AUTH_INVALID` | 认证无效 |
| `INSUFFICIENT_CHIPS` | 筹码不足 |
| `NOT_YOUR_TURN` | 不是你的回合 |
| `INVALID_ACTION` | 无效操作 |
| `ROOM_NOT_FOUND` | 房间不存在 |
| `PLAYER_NOT_FOUND` | 玩家不存在 |
| `GAME_NOT_STARTED` | 游戏未开始 |
| `ALREADY_IN_QUEUE` | 已在队列中 |

---

## 盲注级别配置

| 级别 | 小盲注 | 大盲注 | 最低筹码要求 |
|------|--------|--------|--------------|
| low | 5 | 10 | 10 |
| medium | 10 | 20 | 20 |
| high | 25 | 50 | 50 |

---

## 更新日志

### 2026-03-19
- 新增玩家连接状态模型（ONLINE/DISCONNECTED/REMOVED）
- 统一断线重连逻辑
- 更新游戏状态字段，新增 `connectionState`
- 新增 `game:readyProgress` 事件
- 新增 `game:busted` 事件
- 新增 `game:reconnected` 事件
