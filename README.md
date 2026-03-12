# Texas Hold'em Poker - Walkthrough

## What Was Built

A full-stack Texas Hold'em poker game with complete frontend-backend separation. All game logic runs on the backend.

## Architecture

| Layer | Tech | Port |
|-------|------|------|
| Backend | Node.js + Express | 3001 |
| Frontend | Vite + Vanilla JS/CSS | 5173 |

## Key Files

### Backend (`server/`)
- [deck.js](file:///Users/evmbp/.gemini/antigravity/aidz/server/game/deck.js) — 52-card deck, Fisher-Yates shuffle
- [evaluator.js](file:///Users/evmbp/.gemini/antigravity/aidz/server/game/evaluator.js) — Hand evaluation (Royal Flush → High Card), best-of-7 selection
- [engine.js](file:///Users/evmbp/.gemini/antigravity/aidz/server/game/engine.js) — Game state machine: blinds, betting rounds, AI decisions, side pots, settlement
- [routes/game.js](file:///Users/evmbp/.gemini/antigravity/aidz/server/routes/game.js) — REST API (new/state/action/next/history)

### Frontend (`client/`)
- [index.html](file:///Users/evmbp/.gemini/antigravity/aidz/client/index.html) — Poker table layout
- [style.css](file:///Users/evmbp/.gemini/antigravity/aidz/client/style.css) — Casino theme (felt table, glassmorphism, gold accents, card animations)
- [main.js](file:///Users/evmbp/.gemini/antigravity/aidz/client/main.js) — API client, rendering, betting UI

## Features

- ✅ Random deck shuffle & dealing from backend
- ✅ 4 betting rounds: Pre-flop → Flop → Turn → River
- ✅ Player actions: Fold / Check / Call / Raise / All-in
- ✅ 3 AI opponents with hand-strength-based strategy
- ✅ Full hand evaluation (all 10 poker hand ranks)
- ✅ Side pot calculation for all-in scenarios
- ✅ Showdown with winner determination & chip settlement
- ✅ Game history recording & viewing
- ✅ Dealer button rotation, blind posting
- ✅ AI auto-rebuy when busted

## Browser Test Results

````carousel
![Start screen with premium dark theme and gold accents](/Users/evmbp/.gemini/antigravity/brain/aaa74ebd-51fd-404f-8962-251592176e5f/start_screen_actual_1773325084263.png)
<!-- slide -->
![Showdown: community cards displayed, hands evaluated, Charlie wins with Two Pair](/Users/evmbp/.gemini/antigravity/brain/aaa74ebd-51fd-404f-8962-251592176e5f/showdown_result_1773325206693.png)
<!-- slide -->
![Second hand: all AI folded, player wins pot of 30 chips](/Users/evmbp/.gemini/antigravity/brain/aaa74ebd-51fd-404f-8962-251592176e5f/hand_2_result_1773325227308.png)
````

## How to Run

```bash
# Terminal 1 — Backend
cd server && npm install && node index.js

# Terminal 2 — Frontend
cd client && npm install && npx vite
```

Open http://localhost:5173
