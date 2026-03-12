// ============================================================
// Texas Hold'em Poker - Frontend Client
// ============================================================

const API = '/api';

// ── State ─────────────────────────────────────────────────────
let gameState = null;
let raiseMode = false;

// ── DOM References ────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  startScreen:    $('#start-screen'),
  gameArea:       $('#game-area'),
  playerName:     $('#player-name'),
  btnStart:       $('#btn-start'),
  handNumber:     $('#hand-number'),
  phaseBadge:     $('#phase-badge'),
  communityCards: $('#community-cards'),
  potAmount:      $('#pot-amount'),
  actionButtons:  $('#action-buttons'),
  raiseControls:  $('#raise-controls'),
  raiseSlider:    $('#raise-slider'),
  raiseValue:     $('#raise-value'),
  btnConfirmRaise:$('#btn-confirm-raise'),
  notification:   $('#notification'),
  historyToggle:  $('#history-toggle'),
  historyPanel:   $('#history-panel'),
  historyClose:   $('#history-close'),
  historyList:    $('#history-list'),
  gameLog:        $('#game-log'),
};

// ── API Client ────────────────────────────────────────────────
async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(`${API}${path}`, opts);
    const data = await res.json();
    if (!res.ok) {
      showNotification(data.error || '操作失败', 'danger');
      return null;
    }
    return data;
  } catch (err) {
    showNotification('网络错误，请检查服务器', 'danger');
    console.error(err);
    return null;
  }
}

// ── Game Actions ──────────────────────────────────────────────
async function startGame() {
  const name = els.playerName.value.trim() || '玩家';
  const state = await api('POST', '/game/new', { playerName: name });
  if (state) {
    gameState = state;
    els.startScreen.classList.add('hidden');
    els.gameArea.classList.remove('hidden');
    render();
  }
}

async function performAction(action, amount = 0) {
  const state = await api('POST', '/game/action', { action, amount });
  if (state) {
    gameState = state;
    render();
  }
}

async function nextHand() {
  const state = await api('POST', '/game/next');
  if (state) {
    gameState = state;
    raiseMode = false;
    render();
  }
}

async function loadHistory() {
  const history = await api('GET', '/game/history');
  if (history) renderHistory(history);
}

// ── Rendering ─────────────────────────────────────────────────
function render() {
  if (!gameState) return;

  renderHeader();
  renderPlayers();
  renderCommunityCards();
  renderPot();
  renderActions();
  renderLog();
  renderLastAction();
}

function renderHeader() {
  els.handNumber.textContent = `第 ${gameState.handNumber} 手`;

  const phaseNames = {
    'WAITING': '等待中',
    'PRE_FLOP': '翻牌前',
    'FLOP': '翻牌',
    'TURN': '转牌',
    'RIVER': '河牌',
    'SHOWDOWN': '摊牌',
    'FINISHED': '结束'
  };

  els.phaseBadge.textContent = phaseNames[gameState.phase] || gameState.phase;
  els.phaseBadge.className = 'badge';
  if (gameState.phase === 'SHOWDOWN') els.phaseBadge.classList.add('warning');
  else if (gameState.phase === 'FINISHED') els.phaseBadge.classList.add('danger');
  else els.phaseBadge.classList.add('active');
}

function renderPlayers() {
  gameState.players.forEach((player, i) => {
    const seatEl = $(`#seat-${i}`);
    if (!seatEl) return;

    const isCurrent = (i === gameState.currentPlayerIndex) &&
      gameState.phase !== 'SHOWDOWN' && gameState.phase !== 'FINISHED';
    const isShowdown = gameState.phase === 'SHOWDOWN';

    // Check if this player won
    let isWinner = false;
    let wonAmount = 0;
    if (isShowdown && gameState.lastAction?.action === 'showdown') {
      const result = gameState.lastAction.results?.find(r => r.name === player.name && r.won > 0);
      if (result) { isWinner = true; wonAmount = result.won; }
    }
    if (isShowdown && gameState.lastAction?.action === 'win_by_fold' && gameState.lastAction.winner === player.name) {
      isWinner = true;
      wonAmount = gameState.lastAction.amount;
    }

    let panelClass = 'player-panel';
    if (isCurrent) panelClass += ' is-current';
    if (player.folded) panelClass += ' is-folded';
    if (isWinner) panelClass += ' is-winner';

    let html = `<div class="${panelClass}">`;
    html += `<div class="player-name">`;
    html += player.name;
    if (player.isDealer) html += ` <span class="dealer-chip">D</span>`;
    html += `</div>`;
    html += `<div class="player-chips">💰 ${player.chips}</div>`;

    if (player.bet > 0) {
      html += `<div class="player-bet">下注: ${player.bet}</div>`;
    }

    if (player.folded) {
      html += `<div class="player-status">已弃牌</div>`;
    } else if (player.allIn) {
      html += `<div class="player-status" style="color: var(--accent-gold)">ALL IN</div>`;
    }

    if (isWinner) {
      html += `<div class="player-hand-name">🏆 +${wonAmount}</div>`;
    }

    if (player.bestHand && isShowdown && !player.folded) {
      html += `<div class="player-hand-name">${player.bestHand}</div>`;
    }

    html += `</div>`;

    // Render cards
    html += `<div class="player-cards">`;
    if (player.holeCards && player.holeCards.length > 0) {
      for (const card of player.holeCards) {
        if (card.hidden) {
          html += `<div class="card card-back ${i !== 0 ? 'card-sm' : ''}"></div>`;
        } else {
          const isRed = card.suit === '♥' || card.suit === '♦';
          const sizeClass = i !== 0 ? 'card-sm' : '';
          html += `<div class="card card-front ${isRed ? 'red' : 'black'} ${sizeClass}">`;
          html += `<span class="card-rank">${card.rank}</span>`;
          html += `<span class="card-suit">${card.suit}</span>`;
          html += `</div>`;
        }
      }
    }
    html += `</div>`;

    seatEl.innerHTML = html;
  });
}

function renderCommunityCards() {
  let html = '';
  if (gameState.communityCards && gameState.communityCards.length > 0) {
    for (const card of gameState.communityCards) {
      const isRed = card.suit === '♥' || card.suit === '♦';
      html += `<div class="card card-front ${isRed ? 'red' : 'black'}">`;
      html += `<span class="card-rank">${card.rank}</span>`;
      html += `<span class="card-suit">${card.suit}</span>`;
      html += `</div>`;
    }
  }
  els.communityCards.innerHTML = html;
}

function renderPot() {
  els.potAmount.textContent = gameState.pot;
}

function renderActions() {
  const actions = gameState.actions || [];
  let html = '';

  if (actions.includes('nextHand')) {
    html += `<button class="btn btn-primary btn-lg" onclick="window._nextHand()">下一手 ➜</button>`;
    els.actionButtons.innerHTML = html;
    els.raiseControls.classList.add('hidden');
    raiseMode = false;
    return;
  }

  if (actions.length === 0) {
    html += `<span style="color: var(--text-muted); font-size: 0.85rem;">等待对手行动...</span>`;
    els.actionButtons.innerHTML = html;
    els.raiseControls.classList.add('hidden');
    return;
  }

  if (actions.includes('fold')) {
    html += `<button class="btn btn-danger" onclick="window._action('fold')">弃牌</button>`;
  }
  if (actions.includes('check')) {
    html += `<button class="btn btn-ghost" onclick="window._action('check')">过牌</button>`;
  }
  if (actions.includes('call')) {
    const callAmount = gameState.currentBet - (gameState.players[0]?.bet || 0);
    html += `<button class="btn btn-success" onclick="window._action('call')">跟注 ${callAmount}</button>`;
  }
  if (actions.includes('raise')) {
    html += `<button class="btn btn-accent" onclick="window._toggleRaise()">加注</button>`;
  }
  if (actions.includes('allin')) {
    html += `<button class="btn btn-primary" onclick="window._action('allin')">全下</button>`;
  }

  els.actionButtons.innerHTML = html;

  // Update raise controls
  if (raiseMode && actions.includes('raise')) {
    const player = gameState.players[0];
    const minRaise = gameState.currentBet + 20; // minimum raise
    const maxRaise = player.chips + player.bet;
    els.raiseSlider.min = minRaise;
    els.raiseSlider.max = maxRaise;
    els.raiseSlider.value = minRaise;
    els.raiseValue.textContent = minRaise;
    els.raiseControls.classList.remove('hidden');
  } else {
    els.raiseControls.classList.add('hidden');
  }
}

function renderLog() {
  if (!gameState.log || gameState.log.length === 0) {
    els.gameLog.innerHTML = '';
    return;
  }
  let html = '';
  for (const entry of gameState.log) {
    html += `<div class="log-entry">${entry}</div>`;
  }
  els.gameLog.innerHTML = html;
  els.gameLog.scrollTop = els.gameLog.scrollHeight;
}

function renderLastAction() {
  if (!gameState.lastAction) return;

  const la = gameState.lastAction;
  if (la.player === 'system') return;

  let text = `${la.player} ${la.action}`;
  if (la.amount) text += ` ${la.amount}`;
  showNotification(text, 'info');
}

function renderHistory(history) {
  if (!history || history.length === 0) {
    els.historyList.innerHTML = '<div style="color: var(--text-muted); text-align:center; padding:20px;">暂无记录</div>';
    return;
  }

  let html = '';
  for (const hand of history) {
    html += `<div class="history-item">`;
    html += `<div class="history-item-header">第 ${hand.handNumber} 手</div>`;
    html += `<div class="history-item-cards">公共牌: ${hand.communityCards.join(' ') || '无'}</div>`;
    html += `<div class="history-item-result">`;
    for (const r of hand.results) {
      const isWinner = r.won > 0;
      html += `<div class="${isWinner ? 'winner' : ''}">${r.name}: ${r.hand}`;
      if (r.cards.length) html += ` (${r.cards.join(' ')})`;
      if (r.won > 0) html += ` → +${r.won}`;
      html += `</div>`;
    }
    html += `</div></div>`;
  }
  els.historyList.innerHTML = html;
}

// ── Notifications ─────────────────────────────────────────────
let notifTimer = null;
function showNotification(text, type = 'info') {
  els.notification.textContent = text;
  els.notification.className = 'notification';
  els.notification.classList.remove('hidden');

  if (notifTimer) clearTimeout(notifTimer);
  notifTimer = setTimeout(() => {
    els.notification.classList.add('hidden');
  }, 2500);
}

// ── Global Event Handlers ─────────────────────────────────────
window._action = (action) => performAction(action);
window._nextHand = () => nextHand();
window._toggleRaise = () => {
  raiseMode = !raiseMode;
  renderActions();
};

// ── Init ──────────────────────────────────────────────────────
function init() {
  // Start button
  els.btnStart.addEventListener('click', startGame);
  els.playerName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startGame();
  });

  // Raise slider
  els.raiseSlider.addEventListener('input', () => {
    els.raiseValue.textContent = els.raiseSlider.value;
  });

  els.btnConfirmRaise.addEventListener('click', () => {
    const amount = parseInt(els.raiseSlider.value);
    raiseMode = false;
    performAction('raise', amount);
  });

  // History panel
  els.historyToggle.addEventListener('click', () => {
    els.historyPanel.classList.remove('hidden');
    loadHistory();
  });

  els.historyClose.addEventListener('click', () => {
    els.historyPanel.classList.add('hidden');
  });

  // Focus name input
  els.playerName.focus();
}

init();
