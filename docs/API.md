# Texas Hold'em Poker - API 文档

## 概述

本文档描述了德州扑克游戏的开放 API，供外部程序和 AI 接入使用。

### 基础信息

| 项目 | 值 |
|------|-----|
| Base URL | `http://localhost:3001/api` |
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

### 2. API Key（推荐用于程序接入）

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

```
ws://localhost:3001/socket.io/?token=<jwt_token>
```

或使用 API Key：

```
ws://localhost:3001/socket.io/?apiKey=<api_key>
```

### 客户端事件（Client → Server）

#### 加入大厅

```javascript
socket.emit('lobby:join', {
  stakeLevel: 'medium'  // 'low' | 'medium' | 'high'
});
```

#### 离开大厅

```javascript
socket.emit('lobby:leave');
```

#### 游戏操作

```javascript
socket.emit('game:action', {
  action: 'call',    // 'fold' | 'check' | 'call' | 'raise' | 'allin'
  amount: 100        // 仅 raise 时需要
});
```

#### 发送聊天

```javascript
socket.emit('chat:send', {
  message: 'Hello everyone!'
});
```

#### 获取游戏历史

```javascript
socket.emit('game:history');
```

---

### 服务端事件（Server → Client）

#### 大厅状态更新

```javascript
socket.on('lobby:state', (data) => {
  // data = { onlineCount: 50, queueCounts: { low: 0, medium: 3, high: 1 } }
});
```

#### 匹配成功

```javascript
socket.on('lobby:matched', (data) => {
  // data = { roomId: 'room_xxx', players: [...], stakeConfig: {...} }
});
```

#### 游戏状态更新

```javascript
socket.on('game:state', (state) => {
  /*
  state = {
    phase: 'PRE_FLOP',      // 'WAITING' | 'PRE_FLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN' | 'FINISHED'
    handNumber: 1,
    communityCards: [],
    pot: 30,
    currentBet: 20,
    currentPlayer: 'player_id',
    players: [
      {
        id: 'player_id',
        name: 'Player1',
        chips: 10000,
        bet: 0,
        folded: false,
        isAllIn: false,
        cards: null,        // 自己的牌会显示
        position: 0         // 0=庄家, 1=小盲, 2=大盲
      }
    ],
    smallBlind: 10,
    bigBlind: 20,
    dealerIndex: 0,
    timeLeft: 30           // 当前玩家剩余时间（秒）
  }
  */
});
```

#### 游戏日志

```javascript
socket.on('game:log', (log) => {
  // log = { time: '12:34:56', message: 'Player1 加注 100' }
});
```

#### 游戏结束

```javascript
socket.on('game:hand_end', (result) => {
  /*
  result = {
    winners: [{ id: 'player_id', amount: 1000, hand: '一对' }],
    communityCards: ['Ah', 'Kd', '5c', '2s', '9h'],
    pot: 1000
  }
  */
});
```

#### 聊天消息

```javascript
socket.on('chat:message', (data) => {
  // data = { userId: 'xxx', username: 'Player1', text: 'Hello!', time: '12:34:56' }
});
```

#### 错误消息

```javascript
socket.on('error', (error) => {
  // error = { code: 'ERROR_CODE', message: 'Error description' }
});
```

---

## 游戏状态机

### 阶段流转

```
WAITING → PRE_FLOP → FLOP → TURN → RIVER → SHOWDOWN → FINISHED
                ↑                                           |
                └───────────────────────────────────────────┘
```

### 玩家操作

| 操作 | 描述 | 条件 |
|------|------|------|
| `fold` | 弃牌 | 任何时候 |
| `check` | 过牌 | 当前无需跟注 |
| `call` | 跟注 | 当前有下注需要跟 |
| `raise` | 加注 | 轮到自己操作 |
| `allin` | 全下 | 有筹码 |

### 盲注级别

| 级别 | 小盲 | 大盲 | 最小买入 |
|------|------|------|----------|
| low | 5 | 10 | 200 |
| medium | 10 | 20 | 400 |
| high | 25 | 50 | 1000 |

---

## 错误码

| HTTP 状态码 | 错误码 | 描述 |
|-------------|--------|------|
| 400 | INVALID_INPUT | 输入参数无效 |
| 401 | UNAUTHORIZED | 未授权或 Token 无效 |
| 403 | FORBIDDEN | 无权限执行此操作 |
| 404 | NOT_FOUND | 资源不存在 |
| 409 | CONFLICT | 资源冲突（如用户名已存在） |
| 429 | RATE_LIMIT | 请求频率超限 |
| 500 | INTERNAL_ERROR | 服务器内部错误 |

---

## 速率限制

| 认证方式 | 限制 |
|----------|------|
| JWT | 100 请求/分钟 |
| API Key | 可自定义，默认 100 请求/分钟 |

---

## 示例代码

### JavaScript/Node.js

```javascript
const io = require('socket.io-client');

// 使用 JWT 连接
const socket = io('http://localhost:3001', {
  auth: { token: 'your_jwt_token' }
});

// 或使用 API Key
const socket = io('http://localhost:3001', {
  auth: { apiKey: 'pk_your_api_key' }
});

// 监听游戏状态
socket.on('game:state', (state) => {
  console.log('Current phase:', state.phase);
  console.log('Pot:', state.pot);
  
  if (state.currentPlayer === myPlayerId) {
    // 轮到我操作
    socket.emit('game:action', { action: 'call' });
  }
});

// 加入大厅
socket.emit('lobby:join', { stakeLevel: 'medium' });

// 监听匹配成功
socket.on('lobby:matched', (data) => {
  console.log('Matched! Room:', data.roomId);
});
```

### Python

```python
import socketio

sio = socketio.Client()

@sio.event
def connect():
    print('Connected!')
    sio.emit('lobby:join', {'stakeLevel': 'medium'})

@sio.on('game:state')
def on_game_state(state):
    print(f"Phase: {state['phase']}, Pot: {state['pot']}")
    if state['currentPlayer'] == my_player_id:
        sio.emit('game:action', {'action': 'call'})

sio.connect('http://localhost:3001', 
            auth={'token': 'your_jwt_token'})
```

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2024-01-15 | 初始版本 |
