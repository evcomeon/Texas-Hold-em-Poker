// ============================================================
// Fill Bot Plugin - 陪玩机器人（与游戏核心解耦）
// 删除本模块及 index.js 中的接线代码后，游戏行为不受影响
// ============================================================

const config = require('../config');

function isBotId(id) {
  return typeof id === 'number' && id < 0;
}

/**
 * 陪玩策略：偏保守，check/call 为主，raise/allin 较少
 */
function decideAction(engine, playerId) {
  const state = engine.getState(playerId);
  const actions = state?.actions || [];
  if (actions.length === 0 || actions[0] === 'nextHand') return null;

  const me = state.players?.find(p => p.id === playerId);
  if (!me) return null;

  const callAmount = (state.currentBet || 0) - (me.bet || 0);
  const random = Math.random();
  let action = 'fold';
  let amount = 0;

  const canCheck = actions.includes('check');
  const canCall = actions.includes('call');
  const canRaise = actions.includes('raise');
  const canAllin = actions.includes('allin');

  if (canCheck && random < 0.6) {
    action = 'check';
  } else if (canCall && random < 0.75) {
    action = 'call';
  } else if (canRaise && random < 0.2) {
    action = 'raise';
    const minRaise = (state.currentBet || 0) + (engine.minRaise || engine.bigBlind || 20);
    amount = Math.min(me.chips, Math.floor(minRaise + (state.pot || 0) * 0.35));
  } else if (canAllin && random < 0.05) {
    action = 'allin';
  } else if (canCall) {
    action = 'call';
  } else if (canCheck) {
    action = 'check';
  }

  return { action, amount };
}

/**
 * 生成 Bot 用户对象 (id: -1, -2, ...)
 */
function createFillBots(count, stakeConfig) {
  const defaultChips = config.game?.defaultStartingChips ?? 1000;
  const bots = [];
  for (let i = 0; i < count; i++) {
    bots.push({
      id: -(i + 1),
      name: `陪玩小助${i + 1}`,
      username: `陪玩小助${i + 1}`,
      chips: defaultChips,
      picture: null,
    });
  }
  return bots;
}

/**
 * 创建 getFillBotsProvider 回调
 * 仅补到目标最小人数，避免出现“1 个真人 + 2 个 Bot”这种
 * 真人一弃牌就只剩 Bot 自己互打的场景。
 */
function createFillBotsProvider(botConfig = {}) {
  const fillCount = botConfig.botFillCount ?? 2;
  const minHumans = botConfig.botMinHumansToFill ?? 2;

  return (humanCount, stakeConfig) => {
    if (humanCount >= minHumans) return [];
    const neededBots = Math.max(0, minHumans - humanCount);
    const botsToAdd = Math.min(fillCount, neededBots);
    if (botsToAdd <= 0) return [];
    return createFillBots(botsToAdd, stakeConfig);
  };
}

/**
 * 创建 onAfterBroadcast 回调：驱动 Bot 行动与 ready
 * helpers: { broadcast, handleAllReady } - 由 socket 层注入
 */
function createBotTurnDriver(botConfig = {}) {
  const thinkDelayMs = botConfig.botThinkDelayMs ?? 1500;
  const pendingBotTurns = new Set();

  return async function onAfterBroadcast(io, roomId, room, lobby, helpers = {}) {
    const engine = room.engine;
    const { broadcast, handleAllReady } = helpers;
    if (!engine) return;

    const phase = engine.phase;

    // SHOWDOWN/FINISHED: Bot 自动 ready
    if (phase === 'SHOWDOWN' || phase === 'FINISHED') {
      const activePlayers = engine.players.filter(
        p => p.chips > 0 && (p.connectionState === 'online' || isBotId(p.id))
      );
      for (const p of activePlayers) {
        if (isBotId(p.id) && !engine.readyForNext.has(p.id)) {
          setTimeout(async () => {
            const result = engine.playerRequestedNextHand(p.id);
            if (broadcast) await broadcast();
            if (result?.ready && handleAllReady) {
              await handleAllReady();
            }
          }, 300 + Math.random() * 500);
        }
      }
      return;
    }

    // 下注阶段: 若当前玩家是 Bot，延迟后执行决策
    if (phase === 'WAITING' || phase === 'PRE_FLOP' || phase === 'FLOP' || phase === 'TURN' || phase === 'RIVER') {
      const currentPlayer = engine.players[engine.currentPlayerIndex];
      if (!currentPlayer || !isBotId(currentPlayer.id)) return;

      const turnKey = `${roomId}-${engine.handNumber}-${engine.currentPlayerIndex}`;
      if (pendingBotTurns.has(turnKey)) return;
      pendingBotTurns.add(turnKey);

      setTimeout(async () => {
        pendingBotTurns.delete(turnKey);
        const botId = currentPlayer.id;
        const stillCurrent = engine.players[engine.currentPlayerIndex]?.id === botId;
        if (!stillCurrent || engine.phase === 'SHOWDOWN' || engine.phase === 'FINISHED') return;

        const decision = decideAction(engine, botId);
        if (!decision) return;

        const result = engine.performAction(botId, decision.action, decision.amount);
        if (!result.error && broadcast) {
          await broadcast();
        }
      }, thinkDelayMs);
    }
  };
}

/**
 * 创建 shouldSkipChipsSave 回调：Bot 不写入 DB
 */
function createShouldSkipChipsSave() {
  return (player) => isBotId(player?.id);
}

/**
 * 创建 getPlayerChips 回调：Bot 用内存 chips，返回数值；真人返回 null 表示查 DB
 */
function createGetPlayerChips() {
  return (player) => {
    if (!player) return null;
    if (isBotId(player.id)) return player.chips ?? config.game?.defaultStartingChips ?? 1000;
    return null;
  };
}

module.exports = {
  isBotId,
  createFillBots,
  createFillBotsProvider,
  createBotTurnDriver,
  createShouldSkipChipsSave,
  createGetPlayerChips,
};
