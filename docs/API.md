# Poker Game API / Socket 文档

本文档按当前代码实现整理，来源是：

- `server/index.js`
- `server/routes/*.js`
- `server/socket.js`
- `server/lobby.js`
- `server/game/engine.js`

如果代码和本文档冲突，以代码为准，并应同步回写本文档。

## 基础信息

| 项目 | 值 |
|------|-----|
| REST Base URL | `http://localhost:3001/api` |
| Socket.IO 入口 | `http://localhost:3001` |
| 健康检查 | `GET /api/health` |
| 数据格式 | JSON |

## 认证方式

### REST

大多数用户接口使用：

```http
Authorization: Bearer <jwt_token>
```

`/api/keys` 的中间件同时接受：

```http
Authorization: Bearer <jwt_token>
Authorization: ApiKey <api_key>
```

### Socket.IO

Socket 不看 HTTP `Authorization` 头，而是看握手里的 `auth`：

```js
const socket = io('http://localhost:3001', {
  auth: { token: '<jwt_token>' }
});

const botSocket = io('http://localhost:3001', {
  auth: { apiKey: '<api_key>' }
});
```

说明：

- API Key 连接 Socket 时，必须带有 `game` 或 `write` 权限。
- 连接失败时会收到 `connect_error`。

## REST API

### 1. 健康检查

```http
GET /api/health
```

示例返回：

```json
{
  "status": "ok",
  "time": "2026-03-27T10:00:00.000Z"
}
```

### 2. 认证接口

#### `POST /api/auth/register`

请求体：

```json
{
  "username": "player1",
  "email": "player1@example.com",
  "password": "password123"
}
```

说明：

- 用户名长度要求 `2-20`
- 密码长度至少 `6`

#### `POST /api/auth/login`

请求体：

```json
{
  "username": "player1",
  "password": "password123"
}
```

#### `POST /api/auth/google`

请求体：

```json
{
  "credential": "<google_id_token>"
}
```

#### `POST /api/auth/guest`

请求体：

```json
{
  "name": "Guest123"
}
```

#### `POST /api/auth/logout`

说明：

- 可带 `Bearer` token
- 服务端会尝试删除 Redis session

#### `GET /api/auth/me`

请求头：

```http
Authorization: Bearer <jwt_token>
```

示例返回：

```json
{
  "user": {
    "id": 1,
    "username": "player1",
    "email": "player1@example.com",
    "avatarUrl": null,
    "chipsBalance": 10000,
    "level": 1,
    "experience": 0,
    "totalGames": 0,
    "wins": 0,
    "totalWinnings": 0,
    "createdAt": "2026-03-27T10:00:00.000Z"
  }
}
```

说明：

- 当前代码里没有 `/api/auth/stats`

### 3. API Key 管理

#### `GET /api/keys`

列出当前用户自己的 key。

#### `POST /api/keys`

请求体：

```json
{
  "name": "OpenClaw",
  "description": "bot client",
  "permissions": ["read", "game"],
  "rateLimit": 100,
  "expiresInDays": 365
}
```

#### `DELETE /api/keys/:id`

删除指定 key。

#### `POST /api/keys/:id/deactivate`

停用指定 key。

### 4. 排行榜

#### `GET /api/leaderboard`

查询参数：

- `type`: `chips` | `wins` | `winnings` | `winrate`
- `limit`: 默认 `50`

#### `GET /api/leaderboard/chips`

按筹码排行。

#### `GET /api/leaderboard/winrate`

按胜率排行，只统计 `total_games >= 10` 的用户。

### 5. 钱包接口

#### `POST /api/wallet/nonce`

用于钱包登录前生成签名消息。

请求体：

```json
{
  "walletAddress": "0x1234567890abcdef1234567890abcdef12345678"
}
```

#### `POST /api/wallet/login`

请求体：

```json
{
  "walletAddress": "0x1234567890abcdef1234567890abcdef12345678",
  "signature": "0x...",
  "message": "欢迎来到德州扑克！..."
}
```

#### `GET /api/wallet/bind/status`

查询当前登录用户是否已绑定钱包。

#### `POST /api/wallet/bind/nonce`

请求体：

```json
{
  "address": "0x1234567890abcdef1234567890abcdef12345678"
}
```

#### `POST /api/wallet/bind/verify`

请求体：

```json
{
  "address": "0x1234567890abcdef1234567890abcdef12345678",
  "signature": "0x...",
  "walletType": "metamask"
}
```

#### `POST /api/wallet/bind/change`

请求体：

```json
{
  "newAddress": "0x1234567890abcdef1234567890abcdef12345678",
  "signature": "0x..."
}
```

#### `GET /api/wallet/my-wallet`

返回当前用户钱包地址与类型。

#### `POST /api/wallet/bind`

旧版兼容接口，仍然存在，但新接入应优先使用 `/bind/nonce` + `/bind/verify`。

### 6. 充值接口

#### `GET /api/recharge/config`

返回充值地址、支持代币、汇率、最小/最大金额和确认块数。

#### `POST /api/recharge/create`

请求体兼容两套字段：

```json
{
  "tokenSymbol": "USDT",
  "tokenAmount": 10
}
```

或：

```json
{
  "token": "USDT",
  "amount": 10
}
```

#### `POST /api/recharge/submit-tx`

请求体：

```json
{
  "orderId": "ORD202603270001",
  "txHash": "0x..."
}
```

#### `GET /api/recharge/status/:orderId`

查询某笔订单状态。

#### `GET /api/recharge/history`

查询当前用户充值历史。

### 7. 游戏调试 REST 接口

这些接口挂在 `/api/game/*`，使用的是 `server/routes/game.js` 内部那一个共享 `GameEngine` 实例。

说明：

- 这是调试入口，不是 Socket 大厅里的多房间真实牌桌。
- 如果你要验证多人联机流程，应走 Socket。

#### `POST /api/game/new`

两种创建方式：

1. 显式传 `players`

```json
{
  "players": [
    { "id": "p1", "name": "Alice", "chips": 1000 },
    { "id": "p2", "name": "Bob", "chips": 1000 }
  ]
}
```

2. 只传 `playerName`，服务端自动补一个默认对手

```json
{
  "playerName": "Alice",
  "opponentName": "Bob"
}
```

#### `GET /api/game/state`

可选查询参数：

- `viewerUserId`

#### `POST /api/game/action`

请求体：

```json
{
  "userId": "p1",
  "action": "raise",
  "amount": 120
}
```

说明：

- `action` 支持：`fold` / `check` / `call` / `raise` / `allin`
- `userId` 省略时，会回退到当前行动玩家

#### `POST /api/game/next`

开始下一手。

#### `GET /api/game/history`

返回该调试引擎最近历史。

## Socket.IO API

### 客户端事件

| 事件 | 负载 | 说明 |
|------|------|------|
| `lobby:join` | `{ stakeLevel }` | 加入某个盲注级别的队列 |
| `lobby:leave` | 无 | 离开队列 |
| `lobby:join_specific` | `{ tableId }` | 指定加入一张桌；若牌局进行中会以观战者进入 |
| `game:leave` | 无 | 主动离桌/离开观战 |
| `game:action` | `{ action, amount? }` | 发送牌局动作 |
| `game:next` | 无 | 准备下一手 |
| `game:history` | 无 | 拉取房间最近历史 |
| `game:chat` | `{ text }` | 发送房间聊天 |

### 服务端事件

| 事件 | 说明 |
|------|------|
| `tables:update` | 当前所有桌子的缩略信息列表 |
| `lobby:stats` | 大厅在线人数 |
| `lobby:queued` | 成功进入匹配队列 |
| `lobby:left` | 已离开队列或牌桌 |
| `lobby:error` | 加入大厅或指定桌失败 |
| `game:start` | 作为玩家进入牌桌 |
| `game:spectator` | 作为观战者进入牌桌 |
| `game:state` | 视角化牌局状态 |
| `game:error` | 当前牌局动作被拒绝 |
| `game:notification` | 房间通知 |
| `game:readyProgress` | 准备下一手进度 |
| `game:history` | 历史记录 |
| `game:chat` | 房间聊天广播 |
| `game:reconnected` | 断线重连恢复成功 |
| `game:timeout` | 某玩家行动超时并被系统自动处理 |
| `game:kicked` | 准备超时被移除 |
| `game:busted` | 筹码不足，无法继续作为玩家 |

### `tables:update` 数据结构

单张桌子的结构来自 `TableInfo.toJSON()`：

```json
{
  "id": "room_xxx",
  "stakeLevel": "medium",
  "stakeName": "中注桌",
  "smallBlind": 10,
  "bigBlind": 20,
  "players": [
    {
      "id": 1,
      "username": "alice",
      "avatar": null,
      "ready": false,
      "connectionState": "online",
      "chips": 1000,
      "folded": false,
      "isActive": true
    }
  ],
  "playerCount": 1,
  "maxPlayers": 8,
  "spectatorCount": 0,
  "phase": "WAITING",
  "isFull": false,
  "createdAt": 1760000000000
}
```

### `game:state` 关键字段

```json
{
  "phase": "PRE_FLOP",
  "handNumber": 1,
  "pot": 30,
  "sidePots": [],
  "communityCards": [],
  "currentBet": 20,
  "currentPlayerIndex": 1,
  "dealerIndex": 0,
  "lastAction": null,
  "isSpectator": false,
  "isPlayer": true,
  "maxPlayers": 8,
  "playerCount": 2,
  "spectatorCount": 0,
  "turnTimeout": 30,
  "remainingTime": 29,
  "readyTimeout": 30,
  "readyRemainingTime": null,
  "players": [
    {
      "id": 1,
      "name": "Alice",
      "chips": 990,
      "bet": 10,
      "totalBet": 10,
      "folded": false,
      "allIn": false,
      "isDealer": true,
      "isActive": true,
      "disconnected": false,
      "connectionState": "online",
      "isMe": true,
      "originalIndex": 0,
      "holeCards": [
        { "rank": "A", "suit": "spades", "display": "A♠" },
        { "rank": "K", "suit": "hearts", "display": "K♥" }
      ]
    }
  ],
  "actions": ["fold", "call", "raise", "allin"],
  "log": ["[12:34:56] Alice 加入桌子 (筹码: 1000)"]
}
```

补充说明：

- 非自己玩家的底牌在 `SHOWDOWN/FINISHED` 之前会被隐藏
- `actions` 是当前视角允许的动作集合
- 当 `phase` 为 `SHOWDOWN` 或 `FINISHED` 时，`actions` 会返回 `["nextHand"]` 作为提示，但真正提交准备仍然要发 `game:next`

### `game:readyProgress`

```json
{
  "ready": false,
  "count": 1,
  "total": 2,
  "readyPlayers": [1]
}
```

### 典型 Socket 流程

```js
const socket = io('http://localhost:3001', {
  auth: { token: process.env.JWT_TOKEN }
});

socket.on('connect', () => {
  socket.emit('lobby:join', { stakeLevel: 'medium' });
});

socket.on('game:state', (state) => {
  if (state.phase === 'SHOWDOWN' || state.phase === 'FINISHED') {
    socket.emit('game:next');
    return;
  }

  if (state.actions.includes('check')) {
    socket.emit('game:action', { action: 'check' });
  } else if (state.actions.includes('call')) {
    socket.emit('game:action', { action: 'call' });
  }
});
```

## 默认盲注级别

来自 `server/config.js`：

| 级别 | 小盲 | 大盲 | 中文名 |
|------|------|------|--------|
| `low` | 5 | 10 | 低注桌 |
| `medium` | 10 | 20 | 中注桌 |
| `high` | 25 | 50 | 高注桌 |
