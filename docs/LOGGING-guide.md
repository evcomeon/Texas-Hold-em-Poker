# Logging Guide

本文件用于说明当前项目的日志体系、字段约定，以及如何用 `game_action_logs` 快速排查多人联机问题。

## 1. 日志分层

当前系统有两层日志：

### 1.1 结构化运行日志

来源：
- `server/lib/logger.js`
- `recharge-service/src/utils/logger.js`

用途：
- 查看服务启动、连接、鉴权、排队、房间创建、错误、外部依赖失败等运行态问题。

特点：
- JSON / 键值化输出
- 带时间戳、级别、事件名
- 适合 grep、集中采集和后期聚合

### 1.2 动作级数据库日志

数据表：
- `game_action_logs`

用途：
- 排查多人联机牌局中的状态流转和动作问题
- 还原某个房间、某一手牌、某个玩家发生了什么

适合回答的问题：
- 某个玩家为什么没进入下一手？
- 某一手在哪个 phase 卡住？
- 某人是否真的发送过 action？
- ready timeout 移除了谁？
- 某房间这一手是谁赢的？

## 2. 结构化日志字段约定

服务端结构化日志建议优先包含这些字段：

- `ts`
  - ISO 时间
- `level`
  - `debug` / `info` / `warn` / `error`
- `event`
  - 稳定事件名，供检索使用
- `roomId`
  - 房间 ID，适用于牌局相关事件
- `userId`
  - 用户 ID
- `stakeLevel`
  - `low` / `medium` / `high`
- `handNumber`
  - 当前手数
- `error`
  - 错误对象序列化内容

建议：
- 查问题时优先按 `event` + `roomId` 聚合，不要只看文本 message。

## 3. game_action_logs 表字段说明

关键字段：

- `room_id`
  - 房间 ID
- `hand_number`
  - 第几手牌
- `stake_level`
  - 盲注级别
- `phase`
  - `WAITING` / `PRE_FLOP` / `FLOP` / `TURN` / `RIVER` / `SHOWDOWN` / `FINISHED`
- `event_type`
  - 事件类型
- `user_id`
  - 用户 ID，可为空
- `player_name`
  - 玩家名
- `action`
  - 具体动作，如 `call` / `raise` / `fold` / `chat`
- `amount`
  - 动作金额
- `pot`
  - 底池
- `current_bet`
  - 当前下注
- `metadata`
  - 扩展信息

## 4. 目前已记录的关键事件

当前已接入的事件包括：

- `player_action`
- `player_ready_next_hand`
- `chat_message`
- `player_joined_table`
- `hand_started`
- `phase_changed`
- `hand_showdown`
- `hand_won_by_fold`
- `ready_timeout`

说明：
- `player_action` 既会由 Socket 层记录，也会由引擎事件记录。
- 如果后面需要去重分析，应优先看 `event_type + metadata`。

## 5. 常用排障 SQL

### 5.1 查看最近 100 条动作日志

```sql
SELECT id, created_at, room_id, hand_number, phase, event_type, user_id, player_name, action, amount, pot, current_bet
FROM game_action_logs
ORDER BY created_at DESC
LIMIT 100;
```

### 5.2 查看某个房间完整时间线

```sql
SELECT created_at, hand_number, phase, event_type, player_name, action, amount, pot, current_bet, metadata
FROM game_action_logs
WHERE room_id = 'room_xxx'
ORDER BY created_at ASC, id ASC;
```

### 5.3 查看某个房间某一手发生了什么

```sql
SELECT created_at, phase, event_type, player_name, action, amount, pot, current_bet, metadata
FROM game_action_logs
WHERE room_id = 'room_xxx'
  AND hand_number = 12
ORDER BY created_at ASC, id ASC;
```

### 5.4 查 ready timeout 移除了谁

```sql
SELECT room_id, hand_number, created_at, metadata
FROM game_action_logs
WHERE event_type = 'ready_timeout'
ORDER BY created_at DESC
LIMIT 50;
```

### 5.5 查某个玩家最近的牌局动作

```sql
SELECT created_at, room_id, hand_number, phase, event_type, action, amount, pot, current_bet, metadata
FROM game_action_logs
WHERE user_id = 123
ORDER BY created_at DESC
LIMIT 100;
```

### 5.6 查某一手是否缺 phase 切换

```sql
SELECT room_id, hand_number, array_agg(DISTINCT phase ORDER BY phase) AS phases
FROM game_action_logs
WHERE room_id = 'room_xxx'
  AND hand_number = 12
GROUP BY room_id, hand_number;
```

### 5.7 查最近的 showdown 结果

```sql
SELECT created_at, room_id, hand_number, metadata
FROM game_action_logs
WHERE event_type IN ('hand_showdown', 'hand_won_by_fold')
ORDER BY created_at DESC
LIMIT 20;
```

## 6. 排障建议顺序

排多人联机问题时，建议按这个顺序：

1. 先看结构化日志里有没有连接、鉴权、Redis、数据库错误
2. 再按 `room_id` 查 `game_action_logs`
3. 再缩小到 `hand_number`
4. 最后结合 `metadata` 看 ready timeout、赢家、玩家快照

## 7. 当前已知限制

- 还没有统一的日志采集和归档策略
- 还没有自动生成统计报表
- `recharge-service` 和主服务的日志格式还未完全统一成一套字段规范
- 测试脚本目录中的 `console` 输出未统一，不应和服务端运行日志混淆

## 8. 后续建议

下一步建议继续完善：

- 给 `game_action_logs` 增加保留策略
- 为关键事件补唯一追踪字段，减少重复分析成本
- 给压测脚本增加日志汇总器
- 为 `recharge-service` 补统一字段命名规范
