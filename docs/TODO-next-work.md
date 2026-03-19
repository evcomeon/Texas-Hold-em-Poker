# Poker Game Todo

本文件用于让后续开发者、AI 模型或代理在没有当前上下文的情况下，快速接手 `poker-game` 项目。

适用范围：
- 游戏服务器
- 多人联机
- 压测与外挂脚本
- 锦标赛支持
- 钱包与充值

协作约定：
- 默认不要改动游戏规则本身，除非确认是 bug。
- 优先在 `clients/openclaw/` 下补测试、压测、外挂和比赛工具。
- 修改服务端时，优先做可观测性、稳定性、恢复能力相关工作。
- 做完一个任务后，更新本文件状态，避免多个代理重复劳动。

## 当前状态

已完成：
- 修复钱包登录 JWT 生成错误。
- 修复 WebSocket API Key 鉴权。
- 修复充值监控写错数据表的问题。
- 修复 `openclaw` 客户端事件名不一致问题。
- 修复多人联机分桌的若干问题。
- 已支持单实例同一盲注级别下并行开多桌，不再把后续排队用户全部塞成第一桌观战者。
- 已添加锦标赛相关外挂脚本基础：
  - `clients/openclaw/create-tournament-accounts.js`
  - `clients/openclaw/run-tournament.js`
  - `clients/openclaw/tournament-db.js`
- 已完成观战者模式和匹配系统：
  - 输光筹码转为观战模式
  - 观战者筹码不足不参与匹配
  - 下一局玩家和观战者正确匹配
  - 支持11个bot同时测试

未完成：
- 100 人在线持续 30 分钟压测脚本。
- 结构化日志与动作级日志。
- 房间状态快照恢复。
- 明确的断线状态机。
- 比赛专题页或比赛后台页。
- 充值链路的完整联调和回归。

## 最近关键改动

重点关注这些文件：
- `server/lobby.js`
- `server/socket.js`
- `server/routes/wallet.js`
- `server/game/engine.js`
- `recharge-service/src/services/blockchain.js`
- `clients/openclaw/index.js`
- `clients/openclaw/test-multi-bot.js`
- `clients/openclaw/create-tournament-accounts.js`
- `clients/openclaw/run-tournament.js`
- `clients/openclaw/tournament-db.js`

说明：
- `server/lobby.js` 已改成支持单实例多桌分配。
- `server/game/engine.js` 已添加观战者匹配和活跃玩家不足时的处理。
- 当前大厅仍然是现金桌模型，不是原生锦标赛模型。
- 锦标赛功能目前通过外挂脚本编排，不应直接把比赛逻辑硬塞进游戏服务。

## 任务依赖关系图

```
                    ┌─────────────────┐
                    │  动作级日志 (1)  │
                    │   Must Do       │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ 结构化日志 (2)   │
                    │   Must Do       │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │ 压测脚本 (3)     │ │ 断线状态机 (4)  │ │ 房间快照 (5)    │
    │   Must Do       │ │   Must Do       │ │   Must Do       │
    └────────┬────────┘ └────────┬────────┘ └────────┬────────┘
             │                   │                   │
             └───────────────────┼───────────────────┘
                                 │
                                 ▼
                    ┌─────────────────┐
                    │ Socket拆层 (6)  │
                    │  Should Do      │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │ 队列优化 (7)     │ │ 日志分层 (8)    │ │ 配置集中 (9)    │
    │  Should Do      │ │  Should Do      │ │  Should Do      │
    └─────────────────┘ └─────────────────┘ └─────────────────┘
                                 │
                                 ▼
                    ┌─────────────────┐
                    │ 比赛系统 (10)   │
                    │    Later        │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │ 充值回归 (11)    │ │ API文档 (12)    │ │                 │
    │    Later        │ │    Later        │ │                 │
    └─────────────────┘ └─────────────────┘ └─────────────────┘
```

**依赖说明：**
- 任务 1、2 是基础，必须先完成
- 任务 3、4、5 可以并行，但都依赖任务 2
- 任务 6 依赖任务 4、5 的结果
- 任务 7、8、9 可以并行，但都依赖任务 6
- 任务 10、11、12 是后期任务，依赖前面所有基础设施

## Must Do

### 1. 动作级日志
状态：`in_progress`
复杂度：⭐⭐ (中等)
预估工时：4-6 小时
目标：
- 为每次玩家动作、自动超时动作、每手结算、ready 超时补日志。
- 日志应至少包含 `roomId`、`handNumber`、`userId`、`action`、`phase`、`pot`、`currentBet`。
建议位置：
- `server/socket.js`
- `server/game/engine.js`
- `server/db/schema.js`
- `server/models/`
交付物：
- 一张新的 action log 表。
- 一份日志写入封装。
- 至少一份压测后可直接筛查问题的查询示例。
当前进展：
- 已新增 `game_action_logs` 表。
- 已新增 `server/models/gameActionLog.js`。
- 已接入玩家动作、ready next hand、聊天、phase changed、hand started、showdown、win by fold、ready timeout 等关键事件。
- 仍缺查询示例 SQL 和压测后分析脚本。
验收标准：
- [x] 每个玩家动作都有日志记录
- [ ] 超时动作有日志记录
- [x] 每手结算有日志记录
- [x] ready 超时有日志记录
- [x] 日志包含所有必需字段
- [ ] 提供查询示例 SQL

### 2. 结构化日志
状态：`in_progress`
复杂度：⭐⭐ (中等)
预估工时：3-4 小时
目标：
- 替换关键路径上的零散 `console.log`。
- 输出 JSON 或固定键值格式，便于压测后聚合分析。
建议位置：
- `server/index.js`
- `server/socket.js`
- `server/lobby.js`
- `recharge-service/src/`
交付物：
- 日志 helper
- 统一字段规范
- 文档中补一段"如何读日志"
当前进展：
- 已新增 `server/lib/logger.js`。
- 已接入 `server/index.js`、`server/db/index.js`、`server/db/schema.js`、`server/socket.js`、`server/lobby.js` 关键路径。
- `recharge-service/` 尚未接入统一结构化日志。
- 已新增 `docs/LOGGING-guide.md` 日志读取说明。
验收标准：
- [ ] 所有 console.log 替换为结构化日志
- [x] 日志格式统一（JSON 或键值对）
- [x] 包含时间戳、级别、模块、消息等字段
- [x] 文档中有日志读取指南

### 3. 100 人在线 30 分钟压测脚本
状态：`todo`
复杂度：⭐⭐⭐ (较高)
预估工时：8-12 小时
目标：
- 保持 `100` 个连接持续在线。
- 筹码不足的测试用户退出当前活跃玩家队列后，自动创建新测试用户补上。
- 支持日志落盘，测试结束后可用于排查问题。
- 尽量不改游戏服务本身。
建议位置：
- `clients/openclaw/`
建议产物：
- `run-load-test.js`
- `create-load-test-accounts.js`
- `logs/load-tests/<timestamp>/`
最低指标：
- 在线数曲线
- 活跃玩家数
- 房间数
- 超时次数
- 被踢/异常次数
- 断线次数
- busted 次数
验收标准：
- [ ] 可稳定运行 30 分钟
- [ ] 在线数保持在 100 左右
- [ ] 自动补充筹码不足的用户
- [ ] 日志落盘并可分析
- [ ] 输出统计报告

### 4. 断线状态机统一
状态：`done`
复杂度：⭐⭐⭐ (较高)
预估工时：6-8 小时
实际工时：4 小时
目标：
- 统一在线、断线待重连、观战、离桌、 busted 的语义。
- 避免当前"有时删玩家数组，有时只标记 disconnected"的混合策略。
建议位置：
- `server/socket.js`
- `server/game/engine.js`
- `server/lobby.js`
当前进展：
- 已定义 `ConnectionState` 枚举：`ONLINE`、`DISCONNECTED`、`REMOVED`
- 已实现 `markPlayerRemoved()` 方法替代直接删除
- 已实现 `_canPlayerAct()` 和 `_isPlayerConnected()` 辅助方法
- 已实现 `cleanupRemovedPlayers()` 在新手牌开始时清理已移除玩家
- 已更新所有使用 `disconnected` 字段的地方使用统一的状态检查
验收标准：
- [x] 定义清晰的状态枚举
- [x] 掉线后重连行为可预期
- [x] 掉线后未重连行为可预期
- [x] 只剩一名玩家时行为可预期
- [x] 观战补位行为可预期
- [ ] 有状态转换图文档

### 5. 房间状态快照恢复
状态：`todo`
复杂度：⭐⭐⭐⭐ (高)
预估工时：12-16 小时
目标：
- 让服务重启后至少能恢复未完成房间的基础状态，或明确做平滑终止。
- 当前内存态过重，不适合更高强度压测和多实例扩容。
建议位置：
- `server/lobby.js`
- `server/game/engine.js`
- `server/cache/` 或新增持久化模块
最低恢复字段：
- `roomId`
- `stakeLevel`
- `phase`
- `handNumber`
- `players`
- `spectators`
- `currentPlayerIndex`
- `readyForNext`
验收标准：
- [ ] 服务重启后可恢复房间状态
- [ ] 恢复后游戏可继续
- [ ] 有快照保存机制
- [ ] 有快照恢复测试用例

## Should Do

### 6. Socket 层拆分职责
状态：`todo`
复杂度：⭐⭐⭐ (较高)
预估工时：8-10 小时
目标：
- 将鉴权、lobby、game、chat、broadcast 拆开。
建议位置：
- `server/socket.js`
- 新增 `server/socket/` 目录
验收标准：
- [ ] 鉴权逻辑独立模块
- [ ] lobby 逻辑独立模块
- [ ] game 逻辑独立模块
- [ ] chat 逻辑独立模块
- [ ] broadcast 逻辑独立模块

### 7. 队列与分桌公平性优化
状态：`todo`
复杂度：⭐⭐ (中等)
预估工时：4-6 小时
目标：
- 让多桌补位行为更稳定。
- 减少某些桌长期不满、某些桌持续吃新人的情况。
建议位置：
- `server/lobby.js`
验收标准：
- [ ] 多桌人数分布均匀
- [ ] 补位优先级明确
- [ ] 有公平性测试用例

### 8. 游戏历史与调试日志分层
状态：`todo`
复杂度：⭐⭐ (中等)
预估工时：3-4 小时
目标：
- `game_records` 偏业务展示。
- 调试日志应单独存储，不要混为一谈。
验收标准：
- [ ] 业务数据和调试数据分离
- [ ] 有独立的数据保留策略

### 9. 配置集中管理
状态：`in_progress`
复杂度：⭐ (简单)
预估工时：2-3 小时
目标：
- 统一管理 `JWT_SECRET`、超时、盲注、最大桌人数、ready timeout、压测参数。
建议位置：
- `server/config/`
- `clients/openclaw/config.js`
验收标准：
- [ ] 所有配置项集中管理
- [ ] 支持环境变量覆盖
- [x] 有配置文档
当前进展：
- 已新增 `server/config/index.js`。
- 已将 `server/index.js`、`server/auth.js`、`server/db/index.js`、`server/cache/redis.js`、`server/lobby.js`、`server/game/engine.js`、`server/routes/recharge.js`、`server/services/orderVerifier.js`、`server/utils/logger.js` 切到配置中心。
- 已新增 `docs/CONFIG-guide.md`。
- 仍有部分脚本和非关键路径未迁移。

## Later

### 10. 比赛系统专题页或后台页
状态：`todo`
复杂度：⭐⭐⭐⭐ (高)
预估工时：20-30 小时
目标：
- 展示报名、轮次、桌次、晋级、冠军结果。
约束：
- 比赛逻辑优先外挂，不要过早侵入现金桌服务。

### 11. 充值链路完整回归
状态：`todo`
复杂度：⭐⭐⭐ (较高)
预估工时：8-10 小时
目标：
- 订单创建、链上识别、确认到账、加筹码、事务记录全链路核对。
验收标准：
- [ ] 订单创建流程测试通过
- [ ] 链上识别流程测试通过
- [ ] 确认到账流程测试通过
- [ ] 加筹码流程测试通过
- [ ] 事务记录完整

### 12. API / Socket 文档补全
状态：`todo`
复杂度：⭐⭐ (中等)
预估工时：4-6 小时
目标：
- 补齐真实事件名、错误码、状态流转。
验收标准：
- [ ] 所有 API 端点有文档
- [ ] 所有 Socket 事件有文档
- [ ] 所有错误码有说明
- [ ] 状态流转有图示

## 任务进度跟踪

| 任务 | 状态 | 复杂度 | 预估工时 | 实际工时 | 负责人 | 开始日期 | 完成日期 |
|------|------|--------|----------|----------|--------|----------|----------|
| 1. 动作级日志 | in_progress | ⭐⭐ | 4-6h | - | Codex | 2026-03-19 | - |
| 2. 结构化日志 | in_progress | ⭐⭐ | 3-4h | - | Codex | 2026-03-19 | - |
| 3. 压测脚本 | todo | ⭐⭐⭐ | 8-12h | - | - | - | - |
| 4. 断线状态机 | done | ⭐⭐⭐ | 6-8h | 4h | Codex | 2026-03-19 | 2026-03-19 |
| 5. 房间快照 | todo | ⭐⭐⭐⭐ | 12-16h | - | - | - | - |
| 6. Socket拆层 | todo | ⭐⭐⭐ | 8-10h | - | - | - | - |
| 7. 队列优化 | todo | ⭐⭐ | 4-6h | - | - | - | - |
| 8. 日志分层 | todo | ⭐⭐ | 3-4h | - | - | - | - |
| 9. 配置集中 | in_progress | ⭐ | 2-3h | - | Codex | 2026-03-19 | - |
| 10. 比赛系统 | todo | ⭐⭐⭐⭐ | 20-30h | - | - | - | - |
| 11. 充值回归 | todo | ⭐⭐⭐ | 8-10h | - | - | - | - |
| 12. API文档 | todo | ⭐⭐ | 4-6h | - | - | - | - |

**状态说明：**
- `todo`: 未开始
- `in_progress`: 进行中
- `review`: 待审核
- `done`: 已完成
- `blocked`: 被阻塞

## 并行协作建议

适合多代理并行做的切分方式：

代理 A：
- `clients/openclaw/` 压测脚本
- 日志落盘与分析脚本

代理 B：
- `server/socket.js` 拆层
- 结构化日志

代理 C：
- `server/game/engine.js`
- 动作级日志
- 断线状态机

代理 D：
- `recharge-service/`
- 充值回归

协作规则：
- 不要让多个代理同时改 `server/lobby.js` 同一段逻辑。
- 任何人改了大厅或 Socket 事件名，都要同步更新 `clients/openclaw/`。
- 每完成一个任务，更新本文件中对应项的状态和影响文件。

## 开始工作前必读

优先阅读这些文件：
- `README.md`
- `docs/API.md`
- `docs/SYSTEM-overview.md`
- `server/index.js`
- `server/socket.js`
- `server/lobby.js`
- `server/game/engine.js`
- `clients/openclaw/README.md`

## 快速启动命令

服务端：
```bash
cd /Users/evmbp/poker-game/server
node index.js
```

前端：
```bash
cd /Users/evmbp/poker-game/client
npx vite
```

锦标赛账号生成：
```bash
cd /Users/evmbp/poker-game/clients/openclaw
node create-tournament-accounts.js
```

锦标赛执行：
```bash
cd /Users/evmbp/poker-game/clients/openclaw
PLAYER_COUNT=16 node run-tournament.js
```

多机器人测试：
```bash
cd /Users/evmbp/poker-game/clients/openclaw
node test-multi-bot.js
```

## 交接备注

如果你是新的 AI 模型或代理，请先确认：
- 当前是否还有未提交改动。
- `server/lobby.js` 的多桌逻辑是否已被别人继续修改。
- `clients/openclaw/` 的脚本是否仍与最新 socket 事件兼容。
- 本文件是否已经落后于实际代码。
