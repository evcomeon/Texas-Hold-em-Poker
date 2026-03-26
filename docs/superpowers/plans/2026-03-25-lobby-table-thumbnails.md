# Lobby Table Thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task‑by‑task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在游戏大厅展示每张 8 人桌的缩略图，显示桌号、盲注、玩家人数、玩家准备状态，并支持用户直接点击加入指定桌或随机快速加入。

**Architecture:** 在后端 `LobbyManager` 中维护 `TableInfo` 实例并通过 Socket.io 实时广播 `table:update`。前端监听该事件并渲染网格卡片，每张卡片包含桌号、盲注名称、玩家头像+状态徽章、加入按钮。加入逻辑走 `joinSpecificTable`/`joinRandom`，若满员自动转至最近空桌。

**Tech Stack:** Node.js + Express, Socket.io, Vanilla JS on client, Jest for unit tests, Supertest for integration.
---

### Task 1: Frontend UI – Render Table Thumbnails

**Files:**
- Modify: `client/main.js`
- Modify: `client/style.css`
- Create: `client/tableThumbnails.js`
- Create: `client/__tests__/tableThumbnails.test.js`

- [ ] **Step 1: Write failing UI test**
```javascript
import { renderTables } from '../tableThumbnails';

test('renderTables creates a card for each table', () => {
  const tables = [{id:'room_1', stakeName:'中注桌', playerCount:3, maxPlayers:8, spectatorCount:0, isFull:false}];
  document.body.innerHTML = '<div id="lobby"></div>';
  renderTables(tables);
  const cards = document.querySelectorAll('.table-card');
  expect(cards.length).toBe(1);
  expect(cards[0].textContent).toContain('room_1');
});
```

- [ ] **Step 2: Run test to confirm failure** (`npm test client/__tests__/tableThumbnails.test.js`)

- [ ] **Step 3: Implement `renderTables`** (create card grid, fill HTML with table data, attach click listeners for join & random buttons).

- [ ] **Step 4: Run test to verify pass**

- [ ] **Step 5: Commit**
```bash
git add client/tableThumbnails.js client/main.js client/style.css client/__tests__/tableThumbnails.test.js
git commit -m "feat: render lobby table thumbnails UI"
```

---

### Task 2: Backend – Emit Table Updates on State Changes

**Files:**
- Modify: `server/lobby.js` (add `emitTablesUpdate` calls in relevant places)
- Modify: `server/socket.js` (ensure `socket.on('lobby:get_tables')` already exists)
- Create: `tests/lobby/tableUpdate.test.js`

- [ ] **Step 1: Write failing test** (use Supertest to connect socket, trigger a table change, expect `table:update` event with correct payload).

- [ ] **Step 2: Run test (should fail)**

- [ ] **Step 3: Add `emitTablesUpdate()` calls after player join/leave, room creation, and on disconnect** (already partially present, verify all paths).

- [ ] **Step 4: Run test – ensure it passes**

- [ ] **Step 5: Commit**
```bash
git add server/lobby.js tests/lobby/tableUpdate.test.js
git commit -m "feat: broadcast table updates for UI"
```

---

### Task 3: Server Socket – Support Join Specific / Random APIs

**Files:**
- Ensure `socket.on('lobby:join_specific')` and `socket.on('lobby:join_random')` already exist (present). Add detailed response handling if missing.
- Create integration tests for these events.

- [ ] **Step 1: Write failing integration test**: simulate client socket, emit `join_specific` with a valid tableId, expect `lobby:joined` with `success:true` and roomId.

- [ ] **Step 2: Run test (fail)**

- [ ] **Step 3: Add any missing response fields (`error` handling for full tables)**

- [ ] **Step 4: Run test – pass**

- [ ] **Step 5: Commit**
```bash
git add server/socket.js tests/socket/joinSpecific.test.js
git commit -m "fix: ensure join_specific & join_random emit proper responses"
```

---

### Task 4: Frontend – Handle Join Responses & Auto‑Switch on Full Table

**Files:**
- Modify: `client/tableThumbnails.js` (handle `lobby:joined` and `lobby:error` events)
- Modify: `client/main.js` (ensure socket listeners for `lobby:joined`/`lobby:error` are set)
- Create: `client/__tests__/joinFlow.test.js`

- [ ] **Step 1: Write failing test**: mock socket, trigger `join_specific` response with `error:'full'` and `suggestedRoomId`, verify UI automatically calls `join_random` with that suggested ID.

- [ ] **Step 2: Run test (fail)**

- [ ] **Step 3: Implement auto‑switch logic** in UI.

- [ ] **Step 4: Run test (pass)**

- [ ] **Step 5: Commit**
```bash
git add client/tableThumbnails.js client/main.js client/__tests__/joinFlow.test.js
git commit -m "feat: UI auto‑switch when chosen table is full"
```

---

### Task 5: Documentation & README Update

**Files:**
- Modify: `README.md` – add section “大厅桌子缩略图” 描述新功能及使用方法。
- Modify: `docs/features/lobby-table-thumbnails.md` – detailed UI/后端说明。

- [ ] **Step 1: Write failing doc test** (ensure README contains heading “大厅桌子缩略图”).

- [ ] **Step 2: Run test (fail)**

- [ ] **Step 3: Add documentation**

- [ ] **Step 4: Run test (pass)**

- [ ] **Step 5: Commit**
```bash
git add README.md docs/features/lobby-table-thumbnails.md
git commit -m "docs: add lobby table thumbnail feature description"
```

---

### Task 6: Final Code Review & Branch Finishing

**Files:**
- All modified files from previous tasks.

- [ ] **Step 1: Dispatch final code reviewer subagent** (ensure all specs satisfied, no lint errors).

- [ ] **Step 2: If reviewer approves, run `superpowers:finishing-a-development-branch`** to create PR / merge.

---

*All tasks follow TDD, frequent commits, and DRY/YAGNI principles.*