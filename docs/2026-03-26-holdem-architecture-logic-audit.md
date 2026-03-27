# 多人在线德州扑克架构与逻辑审查

日期：2026-03-26

## 1. 审查目标

本次审查基于仓库内现有文档与代码，对这款多人在线德州扑克的系统架构、实时房间模型和牌局规则实现进行交叉核对，目标是回答三件事：

1. 这套系统在设计上打算如何工作。
2. 现在的实现是否真的符合文档描述。
3. 哪些逻辑已经明显不合理，且会直接影响联机稳定性或牌局公平性。

## 2. 审查范围与方法

本次审查阅读了以下文档与代码：

- 文档：`README.md`、`docs/SYSTEM-overview.md`、`docs/API.md`、`clients/openclaw/README.md`
- 入口与联机层：`server/index.js`、`server/socket.js`、`server/lobby.js`
- 规则层：`server/game/engine.js`、`server/game/evaluator.js`、`server/game/deck.js`
- 兼容层与投影层：`server/routes/game.js`、`server/models/table.js`

校验方法分三类：

- 静态核对：对照文档和代码职责是否一致。
- 语法与装载校验：`node --check`、`require()` 最小装载验证。
- 规则复现：用最小 Node 脚本直接驱动 `GameEngine`，验证盲注、断线、边池、短加注/短全下等路径。

## 3. 我对当前架构的理解

### 3.1 目标架构

结合 `docs/SYSTEM-overview.md`，这套系统的目标架构是清晰的：

- `client/` 是 Web 前端，只负责展示和交互。
- `server/` 是主服务，提供 REST、Socket.IO、认证、分桌和牌局驱动。
- `server/socket.js` 是实时入口，做鉴权、事件接入、房间广播和重连。
- `server/lobby.js` 是大厅/房间编排层，负责排队、分桌、观战、补位、断线移除。
- `server/game/engine.js` 是规则内核，负责发牌、盲注、轮转、下注、摊牌、边池、下一手准备。
- `recharge-service/` 是独立充值进程，不应该污染实时牌局逻辑。
- `clients/openclaw/` 是机器人、外挂客户端、联机测试和比赛脚本入口。

### 3.2 设计上的关键数据流

设计上，核心实时路径应该是：

1. 用户通过 Socket 连接并完成 JWT 或 API Key 鉴权。
2. `socket.js` 调用 `LobbyManager` 加入队列或指定桌。
3. `LobbyManager` 创建房间，并为每张桌实例化一个 `GameEngine`。
4. `GameEngine` 维护单桌牌局状态机。
5. `socket.js` 把 `GameEngine.getState(viewerUserId)` 广播给玩家和观战者。
6. 手结束后，通过 ready/观战补位逻辑进入下一手。

### 3.3 当前代码的真实状态

目标架构本身没有问题，这轮代码修完后，当前状态已经明显改善：

- 实时大厅层 `server/lobby.js` 已经恢复到可装载、可分桌、可断线处理的状态。
- Socket 层和大厅层的接口现在能够闭环，房间里的 `players` 已统一代理到 `engine.players`。
- 规则层 `engine.js` 之前几条关键扑克规则错误已经全部收口，包括 short all-in 的 reopen 边界。
- REST 调试路由和测试入口也已经恢复可用；相关系统说明文档现在也已经同步到当前实现。

结论是：架构方向合理，而且这轮代码修复已经把审查文档中的核心问题全部收口；当前主要后续工作已经转成“更高层集成回归覆盖”。

## 4. 校验结果摘要

### 4.1 可直接复现的事实

- `node --check server/lobby.js` 现在可以通过
- `node --check server/game/engine.js` 可以通过
- `npm test -- --runInBand` 现在可以完整通过
- `configureSockets(server, { fillBotsProvider, getPlayerChips })` 现在可以正常装载
- `new LobbyManager().joinQueue(...)` 现在可以返回 `true` 并进入队列流程
- `LobbyManager._findOpenPlayerRoom()` 和 `LobbyManager.onDisconnect()` 现在都不再因 `room.players` 崩溃
- `GameEngine` 的最小复现场景现在显示：
  - heads-up 庄位/盲注顺序已修复
  - 单在线玩家不会再错误开新手牌，而且 `WAITING` 下不会再残留上一手的 `pot/currentBet`
  - 掉线但未弃牌玩家现在可以参与摊牌
  - 弃牌玩家已投入筹码现在能正确留在边池里
  - short all-in 现在不会直接跳街，其他玩家可以补齐差额
  - short all-in 后，已经行动过的玩家现在也不能再非法 `raise/allin`

### 4.2 本轮复审标记

基于你本轮修改后的代码，旧问题的当前状态如下：

- 本轮代码修复后，分档已经明显变化

- 已修复：10 项
- 部分修复：0 项
- 未修复：0 项

本轮已经确认修复的旧问题：

- `LobbyManager` 运行态与 `socket.js` 已重新打通
- 掉线玩家不再被算进“可开新手牌人数”
- 掉线但未弃牌玩家重新获得摊牌权
- 弃牌玩家已投入筹码重新计入边池
- short all-in / short raise 不再错误 reopen betting
- heads-up 庄位/盲注顺序恢复正确
- `room.players` 与 `engine.players` 的状态来源重新统一
- REST 游戏路由已经兼容当前引擎签名并重新挂载
- Jest 配置和 `npm test` 入口已经恢复可用
- `README.md`、`docs/SYSTEM-overview.md`、`docs/API.md`、`clients/openclaw/README.md` 已同步到当前实现

## 5. 不合理逻辑与问题清单

以下问题按严重程度排序。

### P0. `server/lobby.js` 运行态已打通，主实时链路恢复可用

当前状态：已修复

复审备注：

- `server/lobby.js` 现在不仅可以通过 `node --check`，而且 `configureSockets()`、`joinQueue()`、`_findOpenPlayerRoom()`、`onDisconnect()` 这几条主链路都已经重新跑通。
- 房间对象现在通过代理把 `room.players` 统一到 `engine.players`，原来的“房间结构里没有 `players`，使用方却直接访问”的崩溃点已经消失。

证据：

- `configureSockets(server, { fillBotsProvider, getPlayerChips })` 实测已经返回 `configureSockets_ok`。
- `new LobbyManager().joinQueue(...)` 实测已经返回 `true` 并进入 `_checkQueue`。
- `_createRoomWithPlayers()` 创建出的房间对象现在已经暴露 `players`，并且与 `engine.players` 保持同一事实来源。
- 实测 `LobbyManager.onDisconnect('s1')` 已不再抛错。

影响：

- 当前主联机服务已经满足“可稳定匹配/分桌/断线处理”的最低条件。
- 这一条代码问题已经收敛，剩余工作主要是把其他说明文档同步到最新实现。

### P0. 掉线玩家被同时当成“能开局的人”和“不能参与牌局的人”，会开出畸形手牌

当前状态：已修复

复审备注：

- 我重新复跑了上一轮的最小复现场景：现在当只剩 1 名在线玩家 + 1 名掉线玩家时，`nextHand()` 会回到 `WAITING`，不会再发牌、贴盲或开局。
- 这一轮又补上了状态清理：停在 `WAITING` 时，`pot`、`currentBet`、`communityCards` 也会一起重置。

代码位置：

- `server/game/engine.js:257-258`
- `server/game/engine.js:377-395`
- `server/game/engine.js:604-612`
- `server/game/engine.js:695-697`

问题说明：

- `startNewHand()` 用 `connectionState !== REMOVED` 统计“活跃玩家”，把 `DISCONNECTED` 也算作可开局人数。
- 但发牌顺序、盲注顺序、可行动玩家、摊牌玩家又大量依赖 `_isPlayerConnected()`，把 `DISCONNECTED` 排除掉。
- 这导致同一个玩家在不同阶段被当成“存在”与“不存在”。

已复现现象：

- 仅剩 1 名在线玩家 + 1 名掉线玩家时，系统仍会进入 `PRE_FLOP`。
- 在线玩家会同时承担小盲和大盲，实测 `bet = 15`（5 + 10）。
- 掉线玩家依然会被发两张手牌，但后续又不参与轮转与摊牌。

影响：

- 会出现“名义双人桌，实际单人桌”的异常手牌。
- 庄位、盲注、行动顺序全部失真。
- 掉线但未弃牌的玩家可能直接失去应有权益。

### P0. 掉线但未弃牌的玩家会被排除在摊牌之外，直接破坏公平性

当前状态：已修复

复审备注：

- 我重新复跑了“已全下强牌玩家掉线后进入摊牌”的场景：掉线强牌玩家现在能够正常进入 `SHOWDOWN` 并拿到全部底池。

代码位置：

- `server/game/engine.js:391-393`
- `server/game/engine.js:559-566`
- `server/game/engine.js:695-726`

问题说明：

- `handleDisconnect()` 只有在“正好轮到该玩家行动”时，才尝试自动 `fold`。
- 如果玩家在非本人行动回合掉线，他可能仍然持有 live hand。
- 但 `_showdown()` 与“只剩一人获胜”的判断都把 `DISCONNECTED` 玩家从候选集合里排除。

已复现现象：

- 玩家 A 已经全下且牌力更强，随后掉线。
- 到摊牌时，A 被完全忽略，底池直接判给在线玩家 B。

影响：

- 这是直接的结算错误，不是 UI 问题。
- 只要发生掉线，就有可能错判赢家。

### P0. 边池算法把“已弃牌但已经出资的玩家”从池子计算里删除，导致底池漏分

当前状态：已修复

复审备注：

- 我重新复跑了“三人各出资 50，其中一人弃牌”的场景：现在边池金额正确变为 `150`，赢家可拿到完整底池。

代码位置：

- `server/game/engine.js:772-809`
- `server/game/engine.js:816-857`

问题说明：

- `_calculateSidePots()` 只基于 `!folded` 的玩家构造边池。
- 但德州扑克里，弃牌玩家此前投入的筹码仍然属于主池或边池，不能从池子总额里消失。

已复现现象：

- 三人各投入 50，总池 150。
- 其中 1 人后续弃牌。
- 引擎只计算出 100 的边池，并打印 `Side pot calculation mismatch: 100 vs 150`。
- 实际分配也只发出 100，剩余 50 无人获得。

影响：

- 底池金额与结算金额不一致。
- 这是现金桌最严重的规则错误之一。

### P0. 短加注/短全下会错误修改 `currentBet` 和 `minRaise`，导致非法 reopen betting

当前状态：已修复

复审备注：

- 当前规则已经完整收口：当 A 开到 `100`、B 跟到 `100`、C 最后位 short all-in 到 `120` 时，A/B 仍然会得到补齐差额的机会，但已经行动过的玩家不再被允许重新 `raise` 或借 `allin` 非法 reopen betting。
- 我用手工重置筹码/下注状态的最小脚本和回归测试都重新验证过，这条旧问题已经不再复现。

代码位置：

- `server/game/engine.js:528-557`
- `server/game/engine.js:560-584`
- `server/game/engine.js:622-638`

问题说明：

- 这条问题的根因，是系统之前没有正确区分“当前玩家是否已经在上一次完整加注后行动过”。
- 现在规则已经改成按这一事实判断是否允许继续 `raise`，短全下只提高 `currentBet`，不会对已经行动过的玩家 reopen betting。

已复现现象：

- 当前下注 `100`，最小加注增量 `100`，玩家只有 `120`。
- 当前轮到最后一位玩家 short all-in 到 `120` 后，A/B 已经可以依次补齐到 `120`，然后再正常进入下一街。
- 现在 `getState('a').actions` 只返回 `['fold', 'call', 'allin']`。
- 实测 `performAction('a', 'raise', 220)` 和 `performAction('a', 'allin')` 都会被正确拒绝。

影响：

- 这违反标准无限注德州规则。
- 会直接改变后续行动集合与 EV，属于规则层核心错误。

### P1. Heads-up 庄位与盲注顺序错误

当前状态：已修复

复审备注：

- 本轮代码已经为 heads-up 加了单独分支。
- 重新复测后，双人桌现在是“庄家 = 小盲，并且翻前先行动”，符合标准规则。

代码位置：

- `server/game/engine.js:264-298`

问题说明：

- 当前实现统一采用：
  - 小盲 = 庄家下家
  - 大盲 = 小盲下家
  - 先行动 = 大盲下家
- 这在多人桌成立，但 heads-up 例外。
- 双人桌时，庄家本应同时是小盲，并且翻前先行动。

已复现现象：

- 双人局时，系统把庄家设为大盲，非庄设为小盲。
- 当前行动玩家变成非庄玩家。

影响：

- 双人桌的整套位置优势被反转。
- 这是规则偏差，不只是实现细节。

### P1. 房间状态存在双重事实来源，`room.players` 与 `engine.players` 很可能长期漂移

当前状态：已修复

复审备注：

- 这条问题已经在代码层收掉：房间对象现在通过代理把 `room.players` 统一指向 `engine.players`，并且原来那些会把原始用户对象和引擎玩家对象双写到不同数组里的路径也已经清理掉。
- `LobbyManager`、`socket.js`、`TableInfo` 现在看到的是同一份玩家状态。

代码位置：

- `server/lobby.js:111`
- `server/lobby.js:227-231`
- `server/lobby.js:345`
- `server/lobby.js:431-445`
- `server/lobby.js:504-509`
- `server/lobby.js:591-726`
- `server/models/table.js:13-24`

问题说明：

- `GameEngine.createGame()` 会重新构造内部玩家对象。
- `LobbyManager` 同时还维护 `room.players`，并在多个地方直接读写这个数组。
- 从当前残缺代码看，`room.players` 很像仍在保存原始用户对象，而非 `engine.players` 的同一批引用。

影响：

- 这条风险在代码层已经明显降低。
- 继续维护时，只要保持 `engine.players` 为唯一底层来源，就不会再回到上一轮那种结构性漂移。

### P1. 文档/API 与真实实现已经明显漂移，REST 游戏接口处于失效状态

当前状态：已修复

复审备注：

- `server/routes/game.js` 现在已经兼容当前 `GameEngine` 的多人签名，并且 `server/index.js` 也重新把它挂到了 `/api`。
- `POST /api/game/new` 现在支持显式传 `players`，也支持只传 `playerName` 来创建一个默认双人调试局。
- `POST /api/game/action` 现在会按 `(userId, action, amount)` 调用引擎；未传 `userId` 时，也会退回到当前行动玩家。
- `README.md`、`docs/SYSTEM-overview.md`、`docs/API.md`、`clients/openclaw/README.md` 现在都已经按当前路由、Socket 事件和运行方式同步过。

代码位置：

- `docs/SYSTEM-overview.md:25-27`
- `server/index.js:29-35`
- `server/routes/game.js:13-48`
- `server/game/engine.js:83-110`
- `server/game/engine.js:458-472`

问题说明：

- 代码侧的 REST 调试接口已经恢复可用。
- 之前漂移的系统说明文档也已经同步完成，不再继续引用旧接口或旧运行方式。

已复现现象：

- `POST /api/game/new` 现在已经能把请求体转换成当前引擎需要的玩家数组。
- `POST /api/game/action` 现在已经按当前引擎签名工作。

影响：

- 文档层宣称存在的一部分接口，实际不可用。
- 新接手开发者会被错误文档带偏。

### P2. 自动化测试基础设施本身不可运行，导致当前“已修复”结论缺少保护

当前状态：已修复

复审备注：

- `jest.config.cjs` 现在已经把根工作树的 `server/__tests__` 设为唯一测试根目录，并忽略 `.claude/`。
- `package.json` 的 `npm test` 入口也已经改成显式使用这份配置。
- 当前 `npm test -- --runInBand` 已经可以完整通过。

代码位置：

- `package.json:4-7`
- `jest.config.cjs:1-3`

问题说明：

- 根包声明 `"type": "module"`。
- 但 `jest.config.js` 使用的是 CommonJS `module.exports`。
- 结果 `npm test -- --runInBand` 在载入配置阶段就失败，根本跑不到任何用例。

影响：

- 当前规则层和联机层没有有效回归保护。
- 这也是为什么 `docs/SYSTEM-overview.md` 中“近期已修复”的事项没有被自动化拦住。

## 6. 总体判断

如果只看文档，这个项目的目标是一个“现金桌大厅 + 房间观战补位 + 独立充值服务 + Bot 接入”的在线德州原型，设计方向是合理的。

如果看当前代码状态，结论已经比上一轮更积极一些：

- 规则层的关键公平性问题已经全部收敛。
- 大厅主链路、房间结构、断线处理、观战补位和测试入口都已经重新打通。
- REST 调试接口也已经恢复到与当前引擎一致的签名。
- 系统说明文档也已经重新对齐到当前代码状态。

因此，当前最准确的判断是：审查文档里列出的核心问题已经修完，多人联机主链路已经恢复到可工作的状态。

## 7. 建议修复顺序

这轮代码修完后，更合理的后续顺序已经变成：

1. 如果 REST 调试接口会长期保留，补一层 route-level 自动化测试。
2. 在 Socket 层再补几条更高层的集成测试，覆盖“入队 -> 成桌 -> 掉线 -> 下一手”这条完整多人链路。
3. 继续做长时间多人压测，验证断线重连、观战补位和房间回收在压力下的稳定性。

## 8. 最终结论

这套项目的“架构设计意图”仍然成立，而且这一轮已经把审查文档里真正阻塞联机运行和公平性的代码问题修完了。

现在最主要的遗留工作已经不是文档或底层规则修复，而是继续补更高层的集成测试和压测覆盖。代码层面，这一版已经明显比审查时健康得多。
