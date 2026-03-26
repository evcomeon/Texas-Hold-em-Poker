---
name: lobby-table-thumbnails-design
description: Design for displaying lobby table thumbnails with player status and auto‑join behavior
type: project
---

# 牌桌缩略图功能设计方案（方案 1）

## 目标
在游戏大厅展示每张 8 人桌的缩略图，直观显示：
- 桌号（ID）
- 盲注级别名称（低注/中注/高注）
- 已坐玩家人数 / 最大 8 人
- 每位玩家的头像与准备状态（绿/红徽章）
- 当前盲注大小

用户可以：
1. **直接点击指定桌号** 加入该桌（若未满）。
2. **点击“随机快速开始”**，系统自动把玩家放入最近的有空位桌或随机空桌。
3. 若目标桌已满，系统自动转入 **随机可用桌**（方案 1 的自动补位逻辑）。

## 关键改动概览
| 层 | 文件/模块 | 变更概述 |
|----|----------|----------|
| **后端** | `server/models/table.js`（新建） | 定义 `TableInfo` 数据结构：`{ id, stakeLevel, blind, players: [{id, username, avatar, ready, connectionState}], spectatorCount }` |
| **后端** | `server/lobby.js` | - 在创建/销毁/更新房间时维护 `TableInfo` 列表。<br>- 在关键路径（`_createRoomWithPlayers`, `_leaveRoom`, `joinQueue`, `leaveGame`）后调用 `io.emit('table:update', tablesArray)` 推送所有活跃桌状态。<br>- 新增 `joinSpecificTable(tableId)` 方法，处理玩家直接指定桌号加入的逻辑。 |
| **后端** | `server/index.js`（或现有 socket 初始化） | 复用已有 `io` 实例，确保在 `LobbyManager` 中可访问 `io.emit`。 |
| **前端** | `client/main.js` | - 监听 `socket.on('table:update', renderTables)`。
- 实现 `renderTables(tables)`：生成 HTML 卡片网格（每张桌子 `<div class="table-card" data-id="${id}">`），展示以上信息并在玩家已准备时给绿徽章，未准备时红徽章。
- 卡片内部加入 **“加入桌”** 按钮，点击后 `socket.emit('lobby:join_specific', { tableId })`。
- 添加 **“随机快速开始”** 按钮，点击后 `socket.emit('lobby:join_random')`。
- 统一回执处理 `{ success, error, roomId }`，错误时显示 toast。 |
| **前端** | `client/style.css` | 简单网格布局 (`display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));`)，卡片尺寸约 150×200px，使用圆形头像 + 小徽章表示状态。 |
| **测试** | `test/lobby-table.test.js`（新建） | - 单元测试 `TableInfo` 序列化与计算玩家数。
- 集成测试：
  * 当加入已满桌时，服务器返回 `full:true` 并自动分配另一空桌，玩家最终坐在 `players.length ≤ 8` 的桌子。
  * 随机快速开始时调用 `join_random`，确保玩家被放入已有空位或新创建的桌子。 |
| **文档** | `docs/features/lobby-table-thumbnails.md` | UI 示例、后端事件流、API 说明。 |

## 数据流
1. **玩家动作** → 前端 `socket.emit('lobby:join_specific' / 'lobby:join_random')` → **后端** `LobbyManager` 处理加入逻辑。
2. **状态变更**（玩家加入/离开、准备状态改变） → `LobbyManager` 更新对应 `TableInfo` 并 **广播** `io.emit('table:update', tablesArray)`。
3. **前端** 接收 `table:update` → 调用 `renderTables` 重新渲染所有缩略图，使 UI 与服务器保持实时同步。

## 错误处理
- 所有 socket 回执统一结构：`{ success: boolean, error?: string, roomId?: string }`。
- 前端基于 `error` 类型显示不同 toast（"网络错误"、"桌已满，已自动匹配至桌 ${roomId}"）。
- 后端在 `joinSpecificTable` 中若目标桌满，返回 `{ success:false, error:'full', suggestedRoomId }`，并在同一次请求中完成自动随机分配。

## 兼容性与性能
- 只在 `LobbyManager` 关键路径添加少量广播，广播频率与玩家加入/离开保持一致，负载极低（每次加入/离开最多一次 `table:update`）。
- 现有 `game:state` 广播模型已支撑千级并发，新增的 `table:update` 与之同频，整体带宽仍在可接受范围。
- 若未来桌子数量激增，可在 `LobbyManager` 中加入 **节流**（如 200 ms 内合并多次更新）实现分批广播。

## 实施步骤（写在实现计划前）
1. 创建 `server/models/table.js` 与 `TableInfo` 类。
2. 在 `LobbyManager` 构造函数中初始化 `this.tables = new Map();` 并在房间创建/销毁时同步更新。
3. 实现 `emitTablesUpdate()` 方法统一发送当前表列表。
4. 在关键路径调用 `emitTablesUpdate()`。
5. 前端实现 `renderTables` 与交互按钮。
6. 编写单元/集成测试并加入 CI。
7. 更新文档并提交。

---

**请审阅该设计文档**（已写入 `docs/superpowers/specs/2026-03-25-lobby-table-thumbnails-design.md`），如需修改请告诉我具体修改点。确认后，我将启动 spec‑document‑reviewer 子代理进行审查，然后进入实现计划阶段。
