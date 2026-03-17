# OpenClaw Poker Client

AI 自动扑克客户端，用于接入德州扑克游戏。

## 安装

```bash
cd clients/openclaw
npm install
```

## 配置

### 获取 JWT Token

1. 在浏览器中登录游戏
2. 点击头像 → 复制 API Token

### 创建 API Key（推荐）

```bash
curl -X POST http://localhost:3001/api/keys \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"OpenClaw","permissions":["read","game"],"rateLimit":100}'
```

## 运行

```bash
# 使用 JWT Token
JWT_TOKEN=eyJhbGciOiJIUzI1NiIs... node index.js

# 使用 API Key
API_KEY=pk_xxx node index.js

# 指定盲注级别 (low/medium/high)
JWT_TOKEN=xxx STAKE_LEVEL=high node index.js
```

## 自定义 AI 策略

```javascript
import { OpenClawPokerClient } from './index.js';

const client = new OpenClawPokerClient({
  token: 'your_jwt_token',
  stakeLevel: 'medium',
  
  onGameState: (state) => {
    // 自定义决策逻辑
    if (client.isMyTurn()) {
      // 你的 AI 逻辑
      client.call();
    }
  },
  
  onHandEnd: (result) => {
    console.log('赢家:', result.winners);
  }
});

await client.connect();
client.joinLobby();
```

## API

### 方法

| 方法 | 描述 |
|------|------|
| `connect()` | 连接服务器 |
| `joinLobby(level)` | 加入大厅匹配 |
| `leaveLobby()` | 离开大厅 |
| `fold()` | 弃牌 |
| `check()` | 过牌 |
| `call()` | 跟注 |
| `raise(amount)` | 加注 |
| `allIn()` | 全下 |
| `sendChat(msg)` | 发送聊天 |
| `disconnect()` | 断开连接 |

### 状态查询

| 方法 | 描述 |
|------|------|
| `isMyTurn()` | 是否轮到我 |
| `getMyCards()` | 获取我的手牌 |
| `getMyChips()` | 获取我的筹码 |
| `getPot()` | 获取底池 |
| `getCurrentBet()` | 获取当前下注 |
| `getCommunityCards()` | 获取公共牌 |
| `getPhase()` | 获取游戏阶段 |

## 游戏阶段

- `WAITING` - 等待开始
- `PRE_FLOP` - 翻牌前
- `FLOP` - 翻牌
- `TURN` - 转牌
- `RIVER` - 河牌
- `SHOWDOWN` - 摊牌
- `FINISHED` - 结束
