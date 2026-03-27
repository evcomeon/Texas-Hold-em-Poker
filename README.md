# Poker Game

在线多人德州扑克原型，当前主玩法是现金桌，不是原生锦标赛服。

## 当前包含

- `server/`: Express + Socket.IO 主服务，负责认证、大厅、分桌、牌局驱动、排行榜、钱包与充值接口
- `client/`: Vite 前端
- `recharge-service/`: 独立链上充值监听进程
- `clients/openclaw/`: Bot / 外挂客户端 / 联机验证脚本
- `docs/`: 系统说明、API 文档、审计记录

## 核心事实

- 实时联机主链路在 `server/socket.js` + `server/lobby.js`
- 规则内核在 `server/game/engine.js`
- Socket 支持 `JWT` 和 `API Key` 两种鉴权
- 当前支持观战、补位、掉线重连、ready 下一手
- 根目录 `npm test -- --runInBand` 会跑 `server/__tests__` 下的回归测试

## 快速启动

服务端：

```bash
cd server
npm install
node index.js
```

前端：

```bash
cd client
npm install
npx vite
```

OpenClaw 客户端：

```bash
cd clients/openclaw
npm install
JWT_TOKEN=xxx node index.js
```

或：

```bash
cd clients/openclaw
API_KEY=pk_xxx node index.js
```

## 调试入口

- 健康检查：`GET /api/health`
- REST 调试牌局：`/api/game/new`、`/api/game/state`、`/api/game/action`、`/api/game/next`、`/api/game/history`
- Socket 联机入口：连接 `http://localhost:3001`，在握手里传 `auth.token` 或 `auth.apiKey`

## 先看这些文档

- `docs/SYSTEM-overview.md`
- `docs/API.md`
- `docs/CONFIG-guide.md`
- `docs/LOGGING-guide.md`
- `docs/2026-03-26-holdem-architecture-logic-audit.md`
