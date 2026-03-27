# OpenClaw Poker Client

`clients/openclaw/` 是当前项目的 Bot / 外挂客户端入口，主要用于多人联机验证、脚本化接入和比赛编排。

## 安装

```bash
cd clients/openclaw
npm install
```

## 鉴权

支持两种方式：

1. `JWT_TOKEN`
2. `API_KEY`

Socket 连接会把凭证放进握手 `auth`：

```js
io(API_URL, {
  auth: { token: JWT_TOKEN }
});

io(API_URL, {
  auth: { apiKey: API_KEY }
});
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `API_URL` | `http://localhost:3001` | 服务端地址 |
| `JWT_TOKEN` | 空 | JWT 鉴权 |
| `API_KEY` | 空 | API Key 鉴权 |
| `STAKE_LEVEL` | `medium` | 盲注级别：`low` / `medium` / `high` |

## 运行

```bash
# 使用 JWT
JWT_TOKEN=eyJ... node index.js

# 使用 API Key
API_KEY=pk_xxx node index.js

# 指定盲注级别
JWT_TOKEN=eyJ... STAKE_LEVEL=high node index.js
```

## 当前客户端能力

- 连接 Socket.IO 服务
- 加入大厅队列：`lobby:join`
- 接收 `game:state` 并根据 `state.actions` 做自动决策
- 发送 `fold` / `check` / `call` / `raise` / `allin`
- 发送 `game:next` 准备下一手
- 发送房间聊天

## 主要方法

| 方法 | 说明 |
|------|------|
| `connect()` | 建立 Socket 连接 |
| `joinLobby(level)` | 加入某个盲注级别的匹配队列 |
| `leaveLobby()` | 离开匹配队列 |
| `fold()` / `check()` / `call()` / `raise(amount)` / `allIn()` | 发送牌局操作 |
| `requestNextHand()` | 发送 `game:next` |
| `sendChat(message)` | 发送聊天 |
| `disconnect()` | 断开连接 |

## 状态读取

| 方法 | 说明 |
|------|------|
| `isMyTurn()` | 当前是否轮到自己 |
| `getMyPlayer()` | 返回自己在 `game:state` 里的玩家对象 |
| `getMyCards()` | 获取自己的底牌 |
| `getMyChips()` | 获取自己的筹码 |
| `getPot()` | 获取底池 |
| `getCurrentBet()` | 获取当前下注额 |
| `getCommunityCards()` | 获取公共牌 |
| `getPhase()` | 获取当前阶段 |

## 作为库使用

```js
import { OpenClawPokerClient } from './index.js';

const client = new OpenClawPokerClient({
  token: process.env.JWT_TOKEN,
  stakeLevel: 'medium',
  onGameState(state) {
    if (state.phase === 'SHOWDOWN' || state.phase === 'FINISHED') {
      client.requestNextHand();
      return;
    }

    if (client.isMyTurn()) {
      if (state.actions.includes('check')) client.check();
      else if (state.actions.includes('call')) client.call();
      else client.fold();
    }
  },
});

await client.connect();
client.joinLobby();
```
