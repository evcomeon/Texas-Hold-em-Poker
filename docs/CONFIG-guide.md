# Config Guide

本文件说明主服务当前的集中配置入口，以及新增配置项时应遵守的规则。

## 1. 主入口

主服务统一配置文件：
- `server/config/index.js`

目标：
- 统一环境变量读取
- 集中默认值
- 降低“同一个配置在多个文件里各自写默认值”的风险

## 2. 当前已集中管理的配置

### 2.1 app

- `NODE_ENV`
- `PORT`

### 2.2 logging

- `LOG_LEVEL`

### 2.3 jwt

- `JWT_SECRET`
- `JWT_EXPIRES_IN`

### 2.4 google

- `GOOGLE_CLIENT_ID`

### 2.5 db

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_POOL_MAX`
- `DB_IDLE_TIMEOUT_MS`
- `DB_CONNECTION_TIMEOUT_MS`

### 2.6 redis

- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`

### 2.7 game

- `GAME_MIN_PLAYERS`
- `GAME_MAX_PLAYERS`
- `GAME_DEFAULT_STARTING_CHIPS`
- `TURN_TIMEOUT`
- `READY_TIMEOUT`
- `LOW_SMALL_BLIND`
- `LOW_BIG_BLIND`
- `LOW_STAKE_NAME`
- `MEDIUM_SMALL_BLIND`
- `MEDIUM_BIG_BLIND`
- `MEDIUM_STAKE_NAME`
- `HIGH_SMALL_BLIND`
- `HIGH_BIG_BLIND`
- `HIGH_STAKE_NAME`

### 2.8 recharge

- `CHIPS_PER_USD`
- `MIN_RECHARGE_AMOUNT`
- `MAX_RECHARGE_AMOUNT`
- `RECHARGE_WALLET_ADDRESS`
- `USDT_CONTRACT_ADDRESS`
- `USDC_CONTRACT_ADDRESS`
- `RPC_URL`
- `CONFIRMATION_BLOCKS`
- `ORDER_CHECK_INTERVAL`

## 3. 已接入配置中心的模块

当前已改成读取 `server/config/index.js` 的模块：

- `server/index.js`
- `server/auth.js`
- `server/db/index.js`
- `server/cache/redis.js`
- `server/lobby.js`
- `server/game/engine.js`
- `server/routes/recharge.js`
- `server/services/orderVerifier.js`
- `server/utils/logger.js`

说明：
- 后续如果发现服务端还有直接 `process.env` 读取，应优先迁移到配置中心。

## 4. 新增配置项规则

新增配置时，按这个顺序做：

1. 在 `server/config/index.js` 中新增字段
2. 给出合理默认值
3. 在使用方改为从配置对象读取
4. 更新 `server/.env`
5. 更新本文件

不要做的事：

- 不要在多个模块里重复写同一个默认值
- 不要一部分走 `config`，一部分继续直接 `process.env`
- 不要把业务常量和临时测试值混在一起

## 5. 推荐读取方式

示例：

```js
const config = require('../config');

const timeout = config.game.turnTimeoutSeconds;
const port = config.app.port;
```

不推荐：

```js
const timeout = parseInt(process.env.TURN_TIMEOUT) || 30;
```

## 6. 当前剩余工作

配置集中化还没有完全做完，仍建议继续检查：

- `server/routes/`
- `server/scripts/`
- `server/gen-test-tokens.js`
- `server/verify-token*.js`
- `clients/openclaw/config.js`

其中：
- 调试脚本可以晚一点迁移
- 运行期主路径应优先全部迁移
