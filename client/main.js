// ============================================================
// Texas Hold'em Poker - Frontend Multiplayer Client
// ============================================================

const API = '/api';

// ── State ─────────────────────────────────────────────────────
let gameState = null;
let raiseMode = false;
let user = null;
let token = localStorage.getItem('poker_token') || null;
let socket = null;

// Replace with your Google Client ID for actual deployment
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID_HERE';

// ── DOM References ────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  // Screens
  loginScreen:    $('#login-screen'),
  lobbyScreen:    $('#lobby-screen'),
  gameArea:       $('#game-area'),
  
  // Navbar
  userNavbar:     $('#user-navbar'),
  navAvatar:      $('#nav-avatar'),
  navName:        $('#nav-name'),
  navChips:       $('#nav-chips'),
  btnLogout:      $('#btn-logout'),

  // Login
  googleLoginBtn: $('#google-login-btn'),
  mockPlayerName: $('#mock-player-name'),
  btnMockLogin:   $('#btn-mock-login'),

  // Lobby
  lblOnlineCount: $('#lobby-online-count'),
  btnFindMatch:   $('#btn-find-match'),
  queueStatus:    $('#queue-status'),
  queueCount:     $('#queue-count'),
  btnCancelMatch: $('#btn-cancel-match'),

  // Game Header
  globalOnline:   $('#global-online-count'),
  handNumber:     $('#hand-number'),
  phaseBadge:     $('#phase-badge'),
  
  // Game Table
  communityCards: $('#community-cards'),
  potAmount:      $('#pot-amount'),
  actionButtons:  $('#action-buttons'),
  raiseControls:  $('#raise-controls'),
  raiseSlider:    $('#raise-slider'),
  raiseValue:     $('#raise-value'),
  btnConfirmRaise:$('#btn-confirm-raise'),
  notification:   $('#notification'),
  
  // History
  historyToggle:  $('#history-toggle'),
  historyPanel:   $('#history-panel'),
  historyClose:   $('#history-close'),
  historyList:    $('#history-list'),
  gameLog:        $('#game-log'),
};

// ── Initialization & Auth ─────────────────────────────────────
async function init() {
  setupEventListeners();
  
  // Try to restore session
  if (token) {
    const success = await fetchCurrentUser();
    if (success) {
      showLobby();
      connectSocket();
      return;
    }
  }
  
  showLogin();
  initGoogleAuth();
}

function initGoogleAuth() {
  if (window.google) {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleLogin
    });
    google.accounts.id.renderButton(
      els.googleLoginBtn,
      { theme: 'outline', size: 'large', type: 'standard' }
    );
  }
}

async function handleGoogleLogin(response) {
  await login(response.credential);
}

async function handleMockLogin() {
  const name = els.mockPlayerName.value.trim() || 'Guest' + Math.floor(Math.random()*1000);
  await login(`mock_${name}`);
}

async function login(credential) {
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    token = data.token;
    user = data.user;
    localStorage.setItem('poker_token', token);
    
    showLobby();
    connectSocket();
  } catch (err) {
    showNotification('登录失败: ' + err.message, 'danger');
  }
}

async function fetchCurrentUser() {
  try {
    const res = await fetch(`${API}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    user = data.user;
    return true;
  } catch (err) {
    logout();
    return false;
  }
}

function logout() {
  token = null;
  user = null;
  localStorage.removeItem('poker_token');
  if (socket) socket.disconnect();
  showLogin();
}

// ── Screen Transitions ────────────────────────────────────────
function showLogin() {
  els.loginScreen.classList.remove('hidden');
  els.lobbyScreen.classList.add('hidden');
  els.gameArea.classList.add('hidden');
  els.userNavbar.classList.add('hidden');
  els.globalOnline.classList.add('hidden');
}

function showLobby() {
  els.loginScreen.classList.add('hidden');
  els.lobbyScreen.classList.remove('hidden');
  els.gameArea.classList.add('hidden');
  els.userNavbar.classList.remove('hidden');
  els.globalOnline.classList.remove('hidden');
  
  // Update Navbar
  els.navName.textContent = user.name;
  els.navAvatar.src = user.picture;
  els.navChips.textContent = user.chips;

  // Reset lobby state
  els.btnFindMatch.classList.remove('hidden');
  els.queueStatus.classList.add('hidden');
}

function showGame() {
  els.loginScreen.classList.add('hidden');
  els.lobbyScreen.classList.add('hidden');
  els.gameArea.classList.remove('hidden');
  
  // Hide global online in game, show hand info
  els.globalOnline.classList.add('hidden');
  els.handNumber.classList.remove('hidden');
  els.phaseBadge.classList.remove('hidden');
  els.historyToggle.classList.remove('hidden');
}

// ── WebSockets ────────────────────────────────────────────────
function connectSocket() {
  socket = io({
    auth: { token }
  });

  socket.on('connect', () => {
    console.log('Connected to server');
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error', err);
    if (err.message === 'Authentication error') logout();
  });

  socket.on('lobby:stats', (data) => {
    els.lblOnlineCount.textContent = data.online;
    els.globalOnline.textContent = `在线: ${data.online}`;
  });

  socket.on('lobby:queued', (data) => {
    els.btnFindMatch.classList.add('hidden');
    els.queueStatus.classList.remove('hidden');
    els.queueCount.textContent = data.queueSize;
  });

  socket.on('lobby:left', () => {
    els.btnFindMatch.classList.remove('hidden');
    els.queueStatus.classList.add('hidden');
  });

  socket.on('game:start', (data) => {
    showGame();
  });

  socket.on('game:state', (state) => {
    gameState = state;
    render();
  });

  socket.on('game:error', (err) => {
    showNotification(err.error, 'danger');
  });

  socket.on('game:notification', (data) => {
    showNotification(data.msg, 'info');
  });
}

// ── Game Actions ──────────────────────────────────────────────
function performAction(action, amount = 0) {
  if (socket) {
    socket.emit('game:action', { action, amount });
  }
}

function nextHand() {
  if (socket) {
    socket.emit('game:next');
    // Hide buttons, show waiting msg
    els.actionButtons.innerHTML = `<span style="color: var(--text-muted); font-size: 0.85rem;">等待其他玩家准备...</span>`;
  }
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
  // We want to center the current user at the bottom (seat-0)
  // and distribute others around the table.
  
  if (!gameState.players || gameState.players.length === 0) return;

  // Find my index
  let myIndex = gameState.players.findIndex(p => p.id === user.id);
  if (myIndex === -1) myIndex = 0; // Spectator fallback

  // Reorder players so I am first
  const orderedPlayers = [
    gameState.players[myIndex],
    ...gameState.players.slice(myIndex + 1),
    ...gameState.players.slice(0, myIndex)
  ];

  // Clear all seats
  for(let i=0; i<=3; i++) {
    const seat = $(`#seat-${i}`);
    if (seat) seat.innerHTML = '';
  }

  orderedPlayers.forEach((player, i) => {
    // Only up to 4 players supported by the UI right now mapping to 0,1,2,3
    if (i > 3) return;
    const seatEl = $(`#seat-${i}`);
    if (!seatEl) return;

    // Check if it's their turn (original index matters here)
    const originalIndex = gameState.players.findIndex(p => p.id === player.id);
    const isCurrent = (originalIndex === gameState.currentPlayerIndex) &&
      gameState.phase !== 'SHOWDOWN' && gameState.phase !== 'FINISHED';
    const isShowdown = gameState.phase === 'SHOWDOWN';

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
    if (player.folded || player.disconnected) panelClass += ' is-folded';
    if (isWinner) panelClass += ' is-winner';

    let html = `<div class="${panelClass}">`;
    html += `<div class="player-name">`;
    if (player.picture) {
      html += `<img src="${player.picture}" class="avatar-sm" style="width:18px;height:18px;vertical-align:middle;margin-right:4px;">`;
    }
    html += player.name;
    if (player.isDealer) html += ` <span class="dealer-chip">D</span>`;
    html += `</div>`;
    html += `<div class="player-chips">💰 ${player.chips}</div>`;

    if (player.bet > 0) {
      html += `<div class="player-bet">下注: ${player.bet}</div>`;
    }

    if (player.disconnected) {
       html += `<div class="player-status">已掉线</div>`;
    } else if (player.folded) {
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
    html += `<button class="btn btn-primary btn-lg" onclick="window._nextHand()">准备下一手 ➜</button>`;
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
    const myIndex = gameState.players.findIndex(p => p.id === user.id);
    const myBet = myIndex >= 0 ? gameState.players[myIndex].bet : 0;
    const callAmount = gameState.currentBet - myBet;
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
    const player = gameState.players.find(p => p.id === user.id);
    const minRaise = gameState.currentBet + 20; // assumed min raise
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

// ── Events ────────────────────────────────────────────────────
function setupEventListeners() {
  els.btnMockLogin.addEventListener('click', handleMockLogin);
  els.mockPlayerName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleMockLogin();
  });
  
  els.btnLogout.addEventListener('click', logout);

  els.btnFindMatch.addEventListener('click', () => {
    if (socket) socket.emit('lobby:join');
  });

  els.btnCancelMatch.addEventListener('click', () => {
    if (socket) socket.emit('lobby:leave');
  });

  els.historyToggle.addEventListener('click', () => {
    els.historyPanel.classList.remove('hidden');
    // For now we don't have a history emit, could get from engine
    // socket.emit('game:history');
  });

  els.historyClose.addEventListener('click', () => {
    els.historyPanel.classList.add('hidden');
  });

  els.raiseSlider.addEventListener('input', () => {
    els.raiseValue.textContent = els.raiseSlider.value;
  });

  els.btnConfirmRaise.addEventListener('click', () => {
    const amount = parseInt(els.raiseSlider.value);
    raiseMode = false;
    performAction('raise', amount);
  });
}

// Global exposure for inline HTML handlers
window._action = (action) => performAction(action);
window._nextHand = () => nextHand();
window._toggleRaise = () => {
  raiseMode = !raiseMode;
  renderActions();
};

// Start
init();
