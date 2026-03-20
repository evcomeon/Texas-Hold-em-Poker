// ============================================================
// Texas Hold'em Poker - Frontend Multiplayer Client
// ============================================================

import { walletConnector } from './wallet.js';

const API = import.meta.env.VITE_API_URL || '/api';

// ── State ─────────────────────────────────────────────────────
let gameState = null;
let raiseMode = false;
let user = null;
let token = localStorage.getItem('poker_token') || null;
let socket = null;
let selectedStakeLevel = 'medium';
let isManualLogout = false;
let unreadChatCount = 0;

const GOOGLE_CLIENT_ID = '924040032747-oe8o9abs1ak5i293o6bkplub3h5bolmo.apps.googleusercontent.com';

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
  
  // Multiplayer & Spectator
  spectatorBanner:$('#spectator-banner'),
  spectatorCount: $('#spectator-count'),
  tableInfo:      $('#table-info'),
  
  // Timer
  timerDisplay:  $('#timer-display'),
  timerProgress: $('#timer-progress'),
  timerText:     $('#timer-text'),
  
  // History
  historyToggle:  $('#history-toggle'),
  historyPanel:   $('#history-panel'),
  historyClose:   $('#history-close'),
  historyList:    $('#history-list'),
  
  // Chat
  chatToggle:     $('#chat-toggle'),
  chatPanel:      $('#chat-panel'),
  chatClose:      $('#chat-close'),
  chatMessages:   $('#chat-messages'),
  chatInput:      $('#chat-input'),
  btnSendChat:    $('#btn-send-chat'),
  
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
  
  // Wait for Google SDK to load
  if (window.google) {
    initGoogleAuth();
  } else {
    // Check periodically for Google SDK
    const checkGoogle = setInterval(() => {
      if (window.google) {
        clearInterval(checkGoogle);
        initGoogleAuth();
      }
    }, 100);
    // Timeout after 5 seconds
    setTimeout(() => clearInterval(checkGoogle), 5000);
  }
}

function initGoogleAuth() {
  const container = document.getElementById('google-login-btn');
  if (!container) return;
  
  if (!window.google) {
    console.warn('Google SDK not loaded');
    return;
  }
  
  if (!GOOGLE_CLIENT_ID) {
    console.warn('Google Client ID not configured');
    return;
  }
  
  try {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleLogin,
      auto_select: false
    });
    
    google.accounts.id.renderButton(container, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      width: container.offsetWidth || 280,
      text: 'signin_with',
      shape: 'rectangular'
    });
  } catch (e) {
    console.error('Google auth init error:', e);
  }
}

async function handleGoogleLogin(response) {
  try {
    const res = await fetch(`${API}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    token = data.token;
    user = data.user;
    localStorage.setItem('poker_token', token);
    
    showLobby();
    connectSocket();
  } catch (err) {
    showNotification('Google登录失败: ' + err.message, 'danger');
  }
}

async function handleGuestLogin() {
  const name = document.getElementById('guest-name').value.trim() || `Guest${Math.floor(Math.random()*10000)}`;
  
  try {
    const res = await fetch(`${API}/auth/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    token = data.token;
    user = data.user;
    localStorage.setItem('poker_token', token);
    
    showLobby();
    connectSocket();
  } catch (err) {
    showNotification('游客登录失败: ' + err.message, 'danger');
  }
}

async function handleLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  
  if (!username || !password) {
    errorEl.textContent = '请输入用户名和密码';
    errorEl.classList.remove('hidden');
    return;
  }
  
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    token = data.token;
    user = data.user;
    localStorage.setItem('poker_token', token);
    
    showLobby();
    connectSocket();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

async function handleRegister() {
  const username = document.getElementById('register-username').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  const errorEl = document.getElementById('register-error');
  
  if (!username || !email || !password) {
    errorEl.textContent = '请填写所有字段';
    errorEl.classList.remove('hidden');
    return;
  }
  
  if (username.length < 2 || username.length > 20) {
    errorEl.textContent = '用户名长度必须在2-20个字符之间';
    errorEl.classList.remove('hidden');
    return;
  }
  
  if (password.length < 6) {
    errorEl.textContent = '密码长度至少6个字符';
    errorEl.classList.remove('hidden');
    return;
  }
  
  try {
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    token = data.token;
    user = data.user;
    localStorage.setItem('poker_token', token);
    
    showLobby();
    connectSocket();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
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
  isManualLogout = true;
  token = null;
  user = null;
  localStorage.removeItem('poker_token');
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  hideDisconnectOverlay();
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
  els.navName.textContent = user.username || user.name;
  els.navAvatar.src = user.avatarUrl || user.picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username || user.name}`;
  els.navChips.textContent = (user.chipsBalance || user.chips || 0).toLocaleString();
  
  // Update lobby chips display
  const lobbyChips = document.getElementById('lobby-my-chips');
  if (lobbyChips) {
    lobbyChips.textContent = (user.chipsBalance || user.chips || 0).toLocaleString();
  }

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
  els.tableInfo.classList.remove('hidden');
  els.chatToggle.classList.remove('hidden');
}

// ── Disconnect Overlay ────────────────────────────────────────
function showDisconnectOverlay(message) {
  if (isManualLogout) return;
  
  let overlay = document.getElementById('disconnect-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'disconnect-overlay';
    overlay.className = 'disconnect-overlay';
    overlay.innerHTML = `
      <div class="disconnect-content">
        <div class="disconnect-spinner"></div>
        <p class="disconnect-message">${message}</p>
      </div>
    `;
    document.body.appendChild(overlay);
  } else {
    overlay.querySelector('.disconnect-message').textContent = message;
    overlay.classList.remove('hidden');
  }
}

function hideDisconnectOverlay() {
  const overlay = document.getElementById('disconnect-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
  }
}

// ── WebSockets ────────────────────────────────────────────────
function connectSocket() {
  const socketAuth = { token };
  const wsUrl = import.meta.env.VITE_WS_URL || '';
  const socketPath = import.meta.env.VITE_SOCKET_PATH || '/socket.io';
  
  const socketOptions = {
    path: socketPath,
    auth: socketAuth,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  };

  if (wsUrl) {
    socket = io(wsUrl, socketOptions);
  } else {
    socket = io(socketOptions);
  }

  socket.on('connect', () => {
    console.log('Connected to server');
    hideDisconnectOverlay();
  });

  socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    if (isManualLogout) {
      isManualLogout = false;
      return;
    }
    if (reason === 'io server disconnect') {
      showDisconnectOverlay('服务器断开连接，正在重连...');
    } else {
      showDisconnectOverlay('连接断开，正在重连...');
    }
  });

  socket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected after', attemptNumber, 'attempts');
    showNotification('已重新连接', 'success');
  });

  socket.on('reconnect_failed', () => {
    showDisconnectOverlay('重连失败，请刷新页面');
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error', err);
    if (err.message === 'Authentication error') logout();
  });

  socket.on('game:reconnected', (data) => {
    showNotification(data.message, 'success');
    showGame();
  });

  socket.on('game:kicked', (data) => {
    showNotification(data.reason || '您已被移出游戏', 'warning');
    showLobby();
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

  socket.on('lobby:error', (data) => {
    if (data.error === '筹码不足') {
      showNotification(`筹码不足！需要至少 ${data.minChips} 筹码才能加入此级别游戏。当前筹码: ${data.currentChips}`, 'danger');
    } else {
      showNotification(data.error, 'danger');
    }
  });

  socket.on('lobby:left', () => {
    els.btnFindMatch.classList.remove('hidden');
    els.queueStatus.classList.add('hidden');
  });

  socket.on('game:start', (data) => {
    showGame();
    els.spectatorBanner.classList.add('hidden');
  });
  
  socket.on('game:spectator', (data) => {
    showGame();
    showNotification(data.message, 'info');
    els.spectatorBanner.classList.remove('hidden');
  });
  
  socket.on('game:busted', (data) => {
    showGame();
    els.spectatorBanner.classList.remove('hidden');
    showBustedModal(data);
  });
  
  socket.on('game:readyProgress', (data) => {
    if (!data.ready) {
      showNotification(`准备下一手: ${data.count}/${data.total}`, 'info');
    }
  });

  socket.on('game:readyCountdown', (data) => {
    updateReadyCountdown(data.remaining);
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

  socket.on('game:timeout', (data) => {
    showNotification(data.message, 'warning');
  });

  socket.on('game:history', (data) => {
    renderHistory(data.history);
  });

  socket.on('game:chat', (data) => {
    addChatMessage(data);
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

function backToLobby() {
  if (socket) {
    socket.emit('game:leave');
  }
  // 清理本地游戏状态
  gameState = null;
  raiseMode = false;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  showLobby();
}

// ── Chat ──────────────────────────────────────────────────────
function sendChatMessage() {
  const text = els.chatInput.value.trim();
  if (!text || !socket) return;
  
  socket.emit('game:chat', { text });
  els.chatInput.value = '';
}

function addChatMessage(data) {
  const isOwn = data.userId === user?.id;
  
  const msgEl = document.createElement('div');
  msgEl.className = `chat-message ${isOwn ? 'own' : ''}`;
  
  const time = new Date(data.time);
  const timeStr = time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  
  msgEl.innerHTML = `
    <div class="chat-message-user">${data.userName}</div>
    <div class="chat-message-text">${escapeHtml(data.text)}</div>
    <div class="chat-message-time">${timeStr}</div>
  `;
  
  els.chatMessages.appendChild(msgEl);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  
  // 如果聊天面板关闭且不是自己的消息，增加未读计数
  if (!isOwn && els.chatPanel.classList.contains('hidden')) {
    unreadChatCount++;
    updateChatBadge();
  }
}

function updateChatBadge() {
  const badge = document.getElementById('chat-badge');
  if (unreadChatCount > 0) {
    if (!badge) {
      const newBadge = document.createElement('span');
      newBadge.id = 'chat-badge';
      newBadge.className = 'chat-badge';
      newBadge.textContent = unreadChatCount > 99 ? '99+' : unreadChatCount;
      els.chatToggle.appendChild(newBadge);
    } else {
      badge.textContent = unreadChatCount > 99 ? '99+' : unreadChatCount;
    }
  } else if (badge) {
    badge.remove();
  }
}

function clearChatBadge() {
  unreadChatCount = 0;
  const badge = document.getElementById('chat-badge');
  if (badge) badge.remove();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Rendering ─────────────────────────────────────────────────
function render() {
  if (!gameState) return;

  renderHeader();
  renderPlayers();
  renderCommunityCards();
  renderPot();
  renderActions();
  renderTimer();
  renderLog();
  renderLastAction();
  updateNavbarChips();
}

function updateNavbarChips() {
  if (!gameState || !gameState.players) return;
  
  const myPlayer = gameState.players.find(p => p.id === user?.id);
  if (myPlayer) {
    els.navChips.textContent = myPlayer.chips.toLocaleString();
  }
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
  
  // 显示玩家数量
  const playerCount = gameState.playerCount || gameState.players?.length || 0;
  const maxPlayers = gameState.maxPlayers || 8;
  els.tableInfo.textContent = `玩家: ${playerCount}/${maxPlayers}`;
  els.tableInfo.classList.remove('hidden');
  
  // 显示观战者数量
  const specCount = gameState.spectatorCount || 0;
  if (specCount > 0) {
    els.spectatorCount.textContent = `观战者: ${specCount}`;
  }
}

function renderPlayers() {
  // We want to center the current user at the bottom (seat-0)
  // and distribute others around the table.
  
  if (!gameState.players || gameState.players.length === 0) return;

  // Find my index - 如果是观战者，显示所有玩家但自己在最下方不会显示
  let myIndex = gameState.players.findIndex(p => p.id === user.id);
  const isSpectator = gameState.isSpectator || myIndex === -1;
  
  // 如果是观战者，不重新排序，按原始顺序显示，但把自己当第0位
  let orderedPlayers;
  if (isSpectator) {
    orderedPlayers = gameState.players;
    myIndex = -1; // 观战者不在玩家列表中
  } else {
    // Reorder players so I am first
    orderedPlayers = [
      gameState.players[myIndex],
      ...gameState.players.slice(myIndex + 1),
      ...gameState.players.slice(0, myIndex)
    ];
  }

  // Clear all seats (0-7 for 8 players)
  for(let i=0; i<=7; i++) {
    const seat = $(`#seat-${i}`);
    if (seat) seat.innerHTML = '';
  }

  orderedPlayers.forEach((player, i) => {
    // Support up to 8 players (seat-0 to seat-7)
    // seat-0: bottom (current user if playing)
    // seat-1,2,3: top left, top, top right
    // seat-4,5,6,7: additional seats
    if (i > 7) return;
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
    html += `<button class="btn btn-ghost btn-sm" style="margin-left: 8px;" onclick="window._backToLobby()">返回大厅</button>`;
    // 显示准备倒计时
    if (gameState.readyRemainingTime && gameState.readyRemainingTime > 0) {
      html += `<span class="ready-countdown" style="margin-left: 12px; color: ${gameState.readyRemainingTime <= 10 ? 'var(--danger)' : 'var(--text-muted)'}; font-size: 0.85rem;">⏱ ${gameState.readyRemainingTime}s</span>`;
    }
    els.actionButtons.innerHTML = html;
    els.raiseControls.classList.add('hidden');
    raiseMode = false;
    return;
  }

  if (actions.length === 0) {
    if (gameState.isSpectator) {
      html += `<span style="color: var(--text-muted); font-size: 0.85rem;">观战中</span>`;
      html += `<button class="btn btn-ghost btn-sm" style="margin-left: 8px;" onclick="window._backToLobby()">返回大厅</button>`;
    } else {
      html += `<span style="color: var(--text-muted); font-size: 0.85rem;">等待对手行动...</span>`;
    }
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
let timerInterval = null;

function showNotification(text, type = 'info') {
  els.notification.textContent = text;
  els.notification.className = 'notification';
  els.notification.classList.remove('hidden');

  if (notifTimer) clearTimeout(notifTimer);
  notifTimer = setTimeout(() => {
    els.notification.classList.add('hidden');
  }, 2500);
}

function showBustedModal(data) {
  let modal = document.getElementById('busted-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'busted-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content busted-modal">
        <div class="modal-icon">💸</div>
        <h2>筹码不足</h2>
        <p class="modal-message">您的筹码已用完，无法继续游戏</p>
        <p class="modal-submessage">当前筹码: <span class="chips-count">0</span></p>
        <div class="modal-actions">
          <button class="btn btn-primary" id="btn-recharge">前往充值</button>
          <button class="btn btn-secondary" id="btn-continue-watch">继续观战</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    document.getElementById('btn-recharge').addEventListener('click', () => {
      modal.classList.add('hidden');
      showNotification('充值功能即将上线，敬请期待！', 'info');
    });
    
    document.getElementById('btn-continue-watch').addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  }
  
  modal.querySelector('.chips-count').textContent = data.currentChips || 0;
  modal.classList.remove('hidden');
}

// ── Timer ─────────────────────────────────────────────────────
let readyCountdownInterval = null;

function renderTimer() {
  if (!gameState || !gameState.remainingTime) {
    els.timerDisplay.classList.add('hidden');
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    return;
  }
  
  const isMyTurn = gameState.players && gameState.players[gameState.currentPlayerIndex]?.isMe;
  const hasActions = gameState.actions && gameState.actions.length > 0 && !gameState.actions.includes('nextHand');
  
  if (!isMyTurn || !hasActions) {
    els.timerDisplay.classList.add('hidden');
    return;
  }
  
  els.timerDisplay.classList.remove('hidden');
  updateTimerDisplay(gameState.remainingTime, gameState.turnTimeout);
  
  // 启动本地倒计时更新
  if (timerInterval) clearInterval(timerInterval);
  let remaining = gameState.remainingTime;
  
  timerInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      return;
    }
    updateTimerDisplay(remaining, gameState.turnTimeout);
  }, 1000);
}

function updateReadyCountdown(remaining) {
  // 更新准备倒计时（在 SHOWDOWN 或 FINISHED 阶段）
  const countdownEl = document.querySelector('.ready-countdown');
  if (countdownEl) {
    countdownEl.textContent = `⏱ ${remaining}s`;
    countdownEl.style.color = remaining <= 10 ? 'var(--danger)' : 'var(--text-muted)';
  }
}

function updateTimerDisplay(remaining, total) {
  const percentage = (remaining / total) * 100;
  
  els.timerProgress.style.width = `${percentage}%`;
  els.timerText.textContent = `${remaining}s`;
  
  // 根据剩余时间改变颜色
  els.timerProgress.classList.remove('warning', 'danger');
  els.timerText.classList.remove('warning', 'danger');
  
  if (remaining <= 5) {
    els.timerProgress.classList.add('danger');
    els.timerText.classList.add('danger');
  } else if (remaining <= 10) {
    els.timerProgress.classList.add('warning');
    els.timerText.classList.add('warning');
  }
}

// ── History ───────────────────────────────────────────────────
function renderHistory(history) {
  if (!history || history.length === 0) {
    els.historyList.innerHTML = '<div class="history-empty">暂无对局记录</div>';
    return;
  }

  let html = '';
  history.forEach((hand, index) => {
    html += `<div class="history-item">`;
    html += `<div class="history-header">`;
    html += `<span class="history-hand">第 ${hand.handNumber} 手</span>`;
    html += `<span class="history-cards">${hand.communityCards.join(' ')}</span>`;
    html += `</div>`;
    html += `<div class="history-results">`;
    hand.results.forEach(r => {
      const wonClass = r.won > 0 ? 'winner' : '';
      html += `<div class="history-result ${wonClass}">`;
      html += `<span class="result-name">${r.name}</span>`;
      html += `<span class="result-hand">${r.hand}</span>`;
      if (r.cards && r.cards.length > 0) {
        html += `<span class="result-cards">${r.cards.join(' ')}</span>`;
      }
      if (r.won > 0) {
        html += `<span class="result-won">+${r.won}</span>`;
      }
      html += `</div>`;
    });
    html += `</div>`;
    html += `</div>`;
  });

  els.historyList.innerHTML = html;
}

// ── Events ────────────────────────────────────────────────────
// ── Wallet Login ──────────────────────────────────────────────
async function handleWalletLogin() {
  const wallets = walletConnector.detectWallets();
  const installedWallets = wallets.filter(w => w.installed);
  
  // 如果只有一个已安装的钱包，直接连接
  if (installedWallets.length === 1) {
    await connectWallet(installedWallets[0]);
    return;
  }
  
  // 显示钱包选择弹窗
  showWalletModal(wallets);
}

function showWalletModal(wallets) {
  const modal = document.getElementById('wallet-modal');
  const walletList = document.getElementById('wallet-list');
  
  if (!modal || !walletList) return;
  
  const installedWallets = wallets.filter(w => w.installed);
  const notInstalledWallets = wallets.filter(w => !w.installed);
  
  let html = '';
  
  // 已安装的钱包
  if (installedWallets.length > 0) {
    installedWallets.forEach(wallet => {
      html += `
        <div class="wallet-item installed" data-wallet="${wallet.name}">
          <div class="wallet-icon">${wallet.icon}</div>
          <div class="wallet-info">
            <div class="wallet-name">${wallet.name}</div>
            <div class="wallet-status installed">已安装</div>
          </div>
        </div>
      `;
    });
  }
  
  // 未安装的钱包
  if (notInstalledWallets.length > 0) {
    notInstalledWallets.forEach(wallet => {
      html += `
        <a href="${wallet.url}" target="_blank" class="wallet-item not-installed">
          <div class="wallet-icon">${wallet.icon}</div>
          <div class="wallet-info">
            <div class="wallet-name">${wallet.name}</div>
            <div class="wallet-status not-installed">未安装</div>
          </div>
          <span class="wallet-action">安装</span>
        </a>
      `;
    });
  }
  
  // 如果没有检测到任何钱包
  if (wallets.length === 0) {
    html = `
      <div class="no-wallet-msg">
        <p>未检测到 Web3 钱包</p>
        <p>请安装以下钱包之一：</p>
        <a href="https://metamask.io/download/" target="_blank" class="btn btn-primary">安装 MetaMask</a>
      </div>
    `;
  }
  
  walletList.innerHTML = html;
  modal.classList.remove('hidden');
  
  // 绑定已安装钱包的点击事件
  walletList.querySelectorAll('.wallet-item.installed').forEach(item => {
    item.addEventListener('click', async () => {
      const walletName = item.dataset.wallet;
      const wallet = installedWallets.find(w => w.name === walletName);
      if (wallet) {
        modal.classList.add('hidden');
        await connectWallet(wallet);
      }
    });
  });
  
  // 关闭按钮
  const closeBtn = document.getElementById('wallet-modal-close');
  if (closeBtn) {
    closeBtn.onclick = () => modal.classList.add('hidden');
  }
  
  // 点击背景关闭
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  };
}

async function connectWallet(wallet) {
  try {
    showNotification(`正在连接 ${wallet.name}...`, 'info');
    console.log('[Wallet] 连接钱包:', wallet.name);
    
    // 连接钱包
    const result = await walletConnector.connect(wallet.name);
    console.log('[Wallet] 连接结果:', result);
    
    // 获取 nonce
    console.log('[Wallet] 获取 nonce, 地址:', result.address);
    const nonceRes = await fetch(`${API}/auth/wallet/nonce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: result.address })
    });
    const nonceData = await nonceRes.json();
    console.log('[Wallet] Nonce 响应:', nonceData);
    if (!nonceRes.ok) throw new Error(nonceData.error);
    
    // 签名
    console.log('[Wallet] 签名消息:', nonceData.nonce);
    const signature = await walletConnector.signMessage(nonceData.nonce);
    console.log('[Wallet] 签名结果:', signature);
    
    // 验证签名
    console.log('[Wallet] 验证签名, 地址:', result.address, '签名:', signature);
    const verifyRes = await fetch(`${API}/auth/wallet/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: result.address, signature })
    });
    const data = await verifyRes.json();
    console.log('[Wallet] 验证响应:', data);
    if (!verifyRes.ok) throw new Error(data.error);
    
    token = data.token;
    user = data.user;
    localStorage.setItem('poker_token', token);
    
    showNotification(`${wallet.name} 连接成功！`, 'success');
    showLobby();
    connectSocket();
  } catch (err) {
    console.error('[Wallet] 错误:', err);
    if (err.message === 'NO_WALLET') {
      showNotification('请安装 Web3 钱包', 'danger');
    } else if (err.message.includes('拒绝')) {
      showNotification('用户取消操作', 'warning');
    } else {
      showNotification('钱包登录失败: ' + err.message, 'danger');
    }
  }
}

// ── Profile Panel ──────────────────────────────────────────────
async function showProfilePanel() {
  let panel = document.getElementById('profile-panel');
  
  // 获取钱包绑定状态
  const bindStatus = await checkWalletBindStatus();
  
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'profile-panel';
    panel.className = 'side-panel';
    panel.innerHTML = `
      <div class="panel-header">
        <h3>个人资料</h3>
        <button class="panel-close" id="profile-close">×</button>
      </div>
      <div class="panel-content">
        <div class="profile-avatar">
          <img src="${user?.picture || user?.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.username || user?.name}`}" alt="Avatar">
        </div>
        <div class="profile-info">
          <div class="profile-name">${user?.username || user?.name}</div>
          <div class="profile-email">${user?.email || '未绑定邮箱'}</div>
        </div>
        <div class="profile-stats">
          <div class="stat-item">
            <span class="stat-label">筹码余额</span>
            <span class="stat-value">${(user?.chipsBalance || user?.chips || 0).toLocaleString()}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">总对局</span>
            <span class="stat-value">${user?.gamesPlayed || 0}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">胜率</span>
            <span class="stat-value">${user?.winRate ? (user.winRate * 100).toFixed(1) + '%' : '0%'}</span>
          </div>
        </div>
        <div class="profile-wallet-section">
          <div class="profile-wallet-header">
            <span class="text-muted text-sm">钱包地址</span>
            ${bindStatus.isBound ? '<button class="btn btn-sm btn-ghost" id="btn-change-wallet">更换</button>' : '<button class="btn btn-sm btn-ghost" id="btn-bind-wallet">绑定</button>'}
          </div>
          <div class="profile-wallet-value" id="profile-wallet-display">${bindStatus.isBound ? bindStatus.wallet?.shortAddress : '未绑定'}</div>
        </div>
        <div class="profile-token-section">
          <div class="profile-token-header">
            <span class="text-muted text-sm">API Token (JWT)</span>
            <button class="btn btn-sm btn-ghost" id="btn-copy-token">📋 复制</button>
          </div>
          <div class="profile-token-value" id="profile-token-display">${token ? token.substring(0, 50) + '...' : '未登录'}</div>
        </div>
        <div class="panel-actions">
          <button class="btn btn-primary" id="btn-recharge">充值</button>
          <button class="btn btn-secondary" id="btn-logout-profile">退出登录</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    
    document.getElementById('profile-close').addEventListener('click', hideProfilePanel);
    document.getElementById('btn-logout-profile').addEventListener('click', logout);
    document.getElementById('btn-recharge').addEventListener('click', showRechargePanel);
    
    const bindWalletBtn = document.getElementById('btn-bind-wallet');
    if (bindWalletBtn) {
      bindWalletBtn.addEventListener('click', () => {
        hideProfilePanel();
        showWalletBindPanel(() => showProfilePanel());
      });
    }
    
    const changeWalletBtn = document.getElementById('btn-change-wallet');
    if (changeWalletBtn) {
      changeWalletBtn.addEventListener('click', () => {
        hideProfilePanel();
        showWalletBindPanel(() => showProfilePanel(), true);
      });
    }
  } else {
    // 更新钱包显示
    const walletDisplay = document.getElementById('profile-wallet-display');
    if (walletDisplay) {
      walletDisplay.textContent = bindStatus.isBound ? bindStatus.wallet?.shortAddress : '未绑定';
    }
  }
  
  const tokenDisplay = document.getElementById('profile-token-display');
  if (tokenDisplay) {
    tokenDisplay.textContent = token ? token.substring(0, 50) + '...' : '未登录';
  }
  
  const copyTokenBtn = document.getElementById('btn-copy-token');
  if (copyTokenBtn && !copyTokenBtn.hasListener) {
    copyTokenBtn.hasListener = true;
    copyTokenBtn.addEventListener('click', () => {
      if (token) {
        navigator.clipboard.writeText(token).then(() => {
          copyTokenBtn.textContent = '✓ 已复制';
          setTimeout(() => { copyTokenBtn.textContent = '📋 复制'; }, 2000);
        }).catch(() => {
          showNotification('复制失败', 'danger');
        });
      } else {
        showNotification('未找到 Token', 'danger');
      }
    });
  }
  
  panel.classList.remove('hidden');
}

function hideProfilePanel() {
  const panel = document.getElementById('profile-panel');
  if (panel) panel.classList.add('hidden');
}

// ── Wallet Bind Panel ─────────────────────────────────────────────
let walletBindCallback = null;

async function checkWalletBindStatus() {
  try {
    const res = await fetch(`${API}/wallet/bind/status`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    return data;
  } catch (err) {
    console.error('Check wallet bind status error:', err);
    return { isBound: false };
  }
}

function showWalletBindPanel(onSuccess, isChangeMode = false) {
  walletBindCallback = onSuccess;
  
  let panel = document.getElementById('wallet-bind-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'wallet-bind-panel';
    panel.className = 'modal';
    panel.innerHTML = `
      <div class="modal-content wallet-bind-modal">
        <div class="modal-header">
          <h3 id="wallet-bind-title">🔗 绑定钱包</h3>
          <button class="btn-close" id="wallet-bind-close">✕</button>
        </div>
        <div class="modal-body">
          <p class="text-muted mb-20" id="wallet-bind-desc">充值前需要先绑定 Web3 钱包地址</p>
          
          <div class="wallet-options">
            <button class="wallet-option" data-wallet="metamask">
              <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" alt="MetaMask" class="wallet-icon">
              <span>MetaMask</span>
            </button>
            <button class="wallet-option" data-wallet="coinbase">
              <img src="https://avatars.githubusercontent.com/u/18060234?s=200&v=4" alt="Coinbase" class="wallet-icon">
              <span>Coinbase Wallet</span>
            </button>
          </div>
          
          <div id="wallet-bind-status" class="wallet-bind-status hidden">
            <div class="status-text"></div>
          </div>
          
          <div id="wallet-bind-error" class="wallet-bind-error hidden"></div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    
    document.getElementById('wallet-bind-close').addEventListener('click', hideWalletBindPanel);
    panel.querySelectorAll('.wallet-option').forEach(btn => {
      btn.addEventListener('click', () => handleWalletBind(btn.dataset.wallet, isChangeMode));
    });
  } else {
    // 更新模式文字
    const titleEl = document.getElementById('wallet-bind-title');
    const descEl = document.getElementById('wallet-bind-desc');
    if (isChangeMode) {
      titleEl.textContent = '🔄 更换钱包';
      descEl.textContent = '请选择新的钱包地址进行绑定';
    } else {
      titleEl.textContent = '🔗 绑定钱包';
      descEl.textContent = '充值前需要先绑定 Web3 钱包地址';
    }
    // 更新按钮事件
    panel.querySelectorAll('.wallet-option').forEach(btn => {
      btn.onclick = () => handleWalletBind(btn.dataset.wallet, isChangeMode);
    });
  }
  
  panel.classList.remove('hidden');
}

function hideWalletBindPanel() {
  const panel = document.getElementById('wallet-bind-panel');
  if (panel) panel.classList.add('hidden');
  walletBindCallback = null;
}

async function handleWalletBind(walletType, isChangeMode = false) {
  const statusEl = document.getElementById('wallet-bind-status');
  const errorEl = document.getElementById('wallet-bind-error');
  const statusText = statusEl.querySelector('.status-text');
  
  statusEl.classList.remove('hidden');
  errorEl.classList.add('hidden');
  
  try {
    // 检查钱包是否安装
    if (walletType === 'metamask' && !window.ethereum?.isMetaMask) {
      throw new Error('请先安装 MetaMask 扩展');
    }
    if (walletType === 'coinbase' && !window.ethereum?.isCoinbaseWallet) {
      throw new Error('请先安装 Coinbase Wallet 扩展');
    }
    
    // 连接钱包
    statusText.textContent = '正在连接钱包...';
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const address = accounts[0];
    
    if (!address) {
      throw new Error('未获取到钱包地址');
    }
    
    // 获取绑定 nonce
    statusText.textContent = '获取签名消息...';
    const nonceRes = await fetch(`${API}/wallet/bind/nonce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ address })
    });
    const nonceData = await nonceRes.json();
    if (!nonceRes.ok) throw new Error(nonceData.error);
    
    // 请求签名
    statusText.textContent = '请在钱包中签名...';
    const signature = await window.ethereum.request({
      method: 'personal_sign',
      params: [nonceData.message, address]
    });
    
    // 验证绑定或更换
    statusText.textContent = isChangeMode ? '正在更换...' : '验证绑定...';
    
    const endpoint = isChangeMode ? `${API}/wallet/bind/change` : `${API}/wallet/bind/verify`;
    const body = isChangeMode 
      ? { newAddress: address, signature }
      : { address, signature, walletType };
    
    const verifyRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok) throw new Error(verifyData.error);
    
    // 绑定成功
    statusText.textContent = isChangeMode ? '✅ 更换成功！' : '✅ 绑定成功！';
    statusText.style.color = '#4ade80';
    
    setTimeout(() => {
      hideWalletBindPanel();
      if (walletBindCallback) {
        walletBindCallback();
      }
    }, 1000);
    
  } catch (err) {
    console.error('Wallet bind error:', err);
    statusEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
    errorEl.textContent = err.message || '绑定失败';
  }
}

// ── Recharge Panel ─────────────────────────────────────────────
async function showRechargePanel() {
  // 先检查钱包绑定状态
  const bindStatus = await checkWalletBindStatus();
  
  if (!bindStatus.isBound) {
    showWalletBindPanel(() => showRechargePanel());
    return;
  }
  
  let panel = document.getElementById('recharge-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'recharge-panel';
    panel.className = 'side-panel';
    panel.innerHTML = `
      <div class="panel-header">
        <h3>充值</h3>
        <button class="panel-close" id="recharge-close">×</button>
      </div>
      <div class="panel-content">
        <div class="recharge-wallet-info">
          <span class="text-muted">绑定钱包:</span>
          <span id="recharge-wallet-address" class="wallet-address">${bindStatus.wallet?.shortAddress || '-'}</span>
        </div>
        <div class="recharge-tokens">
          <label>选择代币</label>
          <div class="token-options">
            <button class="token-option active" data-token="USDT">USDT</button>
            <button class="token-option" data-token="USDC">USDC</button>
          </div>
        </div>
        <div class="recharge-amount">
          <label>充值金额</label>
          <input type="number" id="recharge-amount" placeholder="输入金额" min="1">
        </div>
        <div class="recharge-preview">
          <div class="preview-item">
            <span>预计获得筹码</span>
            <span id="preview-chips">0</span>
          </div>
        </div>
        <button class="btn btn-primary btn-block" id="btn-create-order">创建订单</button>
        <button class="btn btn-ghost btn-block mt-10" id="btn-view-history">📋 查看充值记录</button>
      </div>
    `;
    document.body.appendChild(panel);
    
    document.getElementById('recharge-close').addEventListener('click', hideRechargePanel);
    document.querySelectorAll('.token-option').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.token-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateRechargePreview();
      });
    });
    document.getElementById('recharge-amount').addEventListener('input', updateRechargePreview);
    document.getElementById('btn-create-order').addEventListener('click', createRechargeOrder);
    document.getElementById('btn-view-history').addEventListener('click', () => {
      hideRechargePanel();
      showRechargeHistoryPanel();
    });
  } else {
    // 更新钱包地址显示
    const addressEl = document.getElementById('recharge-wallet-address');
    if (addressEl) {
      addressEl.textContent = bindStatus.wallet?.shortAddress || '-';
    }
  }
  
  panel.classList.remove('hidden');
  hideProfilePanel();
}

function hideRechargePanel() {
  const panel = document.getElementById('recharge-panel');
  if (panel) panel.classList.add('hidden');
}

async function showRechargeHistoryPanel() {
  let panel = document.getElementById('recharge-history-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'recharge-history-panel';
    panel.className = 'side-panel';
    panel.innerHTML = `
      <div class="panel-header">
        <h3>充值记录</h3>
        <button class="panel-close" id="history-close">×</button>
      </div>
      <div class="panel-content">
        <div id="history-loading" class="text-center">加载中...</div>
        <div id="history-list" class="history-list"></div>
      </div>
    `;
    document.body.appendChild(panel);
    
    document.getElementById('history-close').addEventListener('click', hideRechargeHistoryPanel);
  }
  
  panel.classList.remove('hidden');
  hideProfilePanel();
  
  await loadRechargeHistory();
}

function hideRechargeHistoryPanel() {
  const panel = document.getElementById('recharge-history-panel');
  if (panel) panel.classList.add('hidden');
}

async function loadRechargeHistory() {
  const loadingEl = document.getElementById('history-loading');
  const listEl = document.getElementById('history-list');
  
  if (!loadingEl || !listEl) return;
  
  loadingEl.classList.remove('hidden');
  listEl.innerHTML = '';
  
  try {
    const res = await fetch(`${API}/recharge/history?limit=50`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    
    if (!res.ok) throw new Error(data.error);
    
    loadingEl.classList.add('hidden');
    
    if (!data.orders || data.orders.length === 0) {
      listEl.innerHTML = '<div class="text-center text-muted">暂无充值记录</div>';
      return;
    }
    
    listEl.innerHTML = data.orders.map(order => `
      <div class="history-item">
        <div class="history-header">
          <span class="history-order-no">${order.orderNo}</span>
          <span class="history-status status-${order.status}">${getStatusText(order.status)}</span>
        </div>
        <div class="history-body">
          <div class="history-row">
            <span class="text-muted">金额</span>
            <span>${order.tokenAmount} ${order.tokenSymbol}</span>
          </div>
          <div class="history-row">
            <span class="text-muted">筹码</span>
            <span class="text-success">+${order.chipsAmount.toLocaleString()}</span>
          </div>
          <div class="history-row">
            <span class="text-muted">时间</span>
            <span>${formatDate(order.createdAt)}</span>
          </div>
          ${order.txHash ? `
          <div class="history-row">
            <span class="text-muted">交易</span>
            <a href="https://etherscan.io/tx/${order.txHash}" target="_blank" class="tx-link">${shortenTxHash(order.txHash)}</a>
          </div>
          ` : ''}
        </div>
      </div>
    `).join('');
    
  } catch (err) {
    loadingEl.classList.add('hidden');
    listEl.innerHTML = `<div class="text-center text-danger">加载失败: ${err.message}</div>`;
  }
}

function getStatusText(status) {
  const statusMap = {
    'pending': '待确认',
    'confirmed': '已确认',
    'completed': '已完成',
    'failed': '失败',
    'cancelled': '已取消'
  };
  return statusMap[status] || status;
}

function shortenTxHash(hash) {
  if (!hash) return '-';
  return hash.substring(0, 10) + '...' + hash.substring(hash.length - 8);
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function updateRechargePreview() {
  const amount = parseFloat(document.getElementById('recharge-amount')?.value) || 0;
  const activeToken = document.querySelector('.token-option.active');
  const selectedToken = activeToken?.dataset.token || 'USDT';
  
  // Conversion rate: 1 token = 10000 chips (aligned with backend config)
  const rates = { USDT: 10000, USDC: 10000, ETH: 20000000 };
  const chips = Math.floor(amount * (rates[selectedToken] || 10000));
  
  const previewEl = document.getElementById('preview-chips');
  if (previewEl) {
    previewEl.textContent = chips.toLocaleString();
  }
}

async function createRechargeOrder() {
  const amount = parseFloat(document.getElementById('recharge-amount')?.value);
  const activeToken = document.querySelector('.token-option.active');
  const selectedToken = activeToken?.dataset.token || 'USDT';
  
  if (!amount || amount <= 0) {
    showNotification('请输入有效金额', 'danger');
    return;
  }
  
  try {
    const res = await fetch(`${API}/recharge/create`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ amount, token: selectedToken })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    
    showOrderPanel(data);
    hideRechargePanel();
  } catch (err) {
    showNotification('创建订单失败: ' + err.message, 'danger');
  }
}

function showOrderPanel(order) {
  let panel = document.getElementById('order-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'order-panel';
    panel.className = 'side-panel';
    panel.innerHTML = `
      <div class="panel-header">
        <h3>订单详情</h3>
        <button class="panel-close" id="order-close">×</button>
      </div>
      <div class="panel-content">
        <div class="order-info">
          <div class="order-item">
            <span>订单号</span>
            <span id="order-id">-</span>
          </div>
          <div class="order-item">
            <span>充值金额</span>
            <span id="order-amount">-</span>
          </div>
          <div class="order-item">
            <span>获得筹码</span>
            <span id="order-chips">-</span>
          </div>
          <div class="order-item">
            <span>状态</span>
            <span id="order-status">待支付</span>
          </div>
        </div>
        <div class="deposit-address">
          <label>充值地址</label>
          <div class="address-box">
            <code id="deposit-address">-</code>
            <button class="btn btn-sm" id="btn-copy-address">复制</button>
          </div>
        </div>
        <div class="tx-input">
          <label>交易哈希 (可选)</label>
          <input type="text" id="tx-hash" placeholder="粘贴交易哈希">
        </div>
        <div class="panel-actions">
          <button class="btn btn-primary" id="btn-submit-tx">提交交易</button>
          <button class="btn btn-secondary" id="btn-refresh-order">刷新状态</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    
    document.getElementById('order-close').addEventListener('click', hideOrderPanel);
    document.getElementById('btn-copy-address').addEventListener('click', copyRechargeAddress);
    document.getElementById('btn-submit-tx').addEventListener('click', submitTransactionHash);
    document.getElementById('btn-refresh-order').addEventListener('click', refreshOrderStatus);
  }
  
  panel.dataset.orderId = order.orderId;
  document.getElementById('order-id').textContent = order.orderId;
  document.getElementById('order-amount').textContent = `${order.amount} ${order.token}`;
  document.getElementById('order-chips').textContent = order.chips.toLocaleString();
  document.getElementById('deposit-address').textContent = order.depositAddress;
  
  panel.classList.remove('hidden');
}

function hideOrderPanel() {
  const panel = document.getElementById('order-panel');
  if (panel) panel.classList.add('hidden');
}

function copyRechargeAddress() {
  const address = document.getElementById('deposit-address')?.textContent;
  if (address && address !== '-') {
    navigator.clipboard.writeText(address).then(() => {
      showNotification('地址已复制', 'success');
    }).catch(() => {
      showNotification('复制失败', 'danger');
    });
  }
}

async function submitTransactionHash() {
  const panel = document.getElementById('order-panel');
  const orderId = panel?.dataset.orderId;
  const txHash = document.getElementById('tx-hash')?.value.trim();
  
  if (!orderId) return;
  
  try {
    const res = await fetch(`${API}/recharge/submit-tx`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ orderId, txHash })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    
    showNotification('交易已提交，等待确认', 'success');
  } catch (err) {
    showNotification('提交失败: ' + err.message, 'danger');
  }
}

async function refreshOrderStatus() {
  const panel = document.getElementById('order-panel');
  const orderId = panel?.dataset.orderId;
  
  if (!orderId) return;
  
  try {
    const res = await fetch(`${API}/recharge/status/${orderId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    
    const statusEl = document.getElementById('order-status');
    if (statusEl) {
      const statusNames = {
        'pending': '待支付',
        'waiting': '等待确认',
        'confirmed': '已确认',
        'completed': '已完成',
        'cancelled': '已取消'
      };
      statusEl.textContent = statusNames[data.status] || data.status;
    }
    
    if (data.status === 'completed') {
      showNotification('充值成功！', 'success');
      // Update user chips
      if (data.newBalance !== undefined) {
        user.chips = data.newBalance;
        user.chipsBalance = data.newBalance;
        els.navChips.textContent = data.newBalance.toLocaleString();
      }
    }
  } catch (err) {
    showNotification('刷新失败: ' + err.message, 'danger');
  }
}

// ── Leaderboard ───────────────────────────────────────────────
async function showLeaderboard() {
  const panel = document.getElementById('leaderboard-panel');
  if (panel) {
    panel.classList.remove('hidden');
    loadLeaderboard('chips');
  }
}

function hideLeaderboard() {
  const panel = document.getElementById('leaderboard-panel');
  if (panel) {
    panel.classList.add('hidden');
  }
}

async function loadLeaderboard(type = 'chips') {
  const listEl = document.getElementById('leaderboard-list');
  if (!listEl) return;
  
  listEl.innerHTML = '<div class="leaderboard-loading">加载中...</div>';
  
  try {
    const res = await fetch(`${API}/leaderboard/${type}?limit=50`);
    const data = await res.json();
    
    if (!res.ok) throw new Error(data.error);
    
    if (!data.leaderboard || data.leaderboard.length === 0) {
      listEl.innerHTML = '<div class="leaderboard-empty">暂无数据</div>';
      return;
    }
    
    listEl.innerHTML = data.leaderboard.map((item, index) => {
      const rank = index + 1;
      const topClass = rank <= 3 ? `top-${rank}` : '';
      const avatarHtml = item.avatarUrl 
        ? `<img src="${item.avatarUrl}" alt="" />` 
        : item.username.charAt(0).toUpperCase();
      
      let valueMain, valueSub, statsText;
      
      if (type === 'chips') {
        valueMain = `💰 ${item.chips.toLocaleString()}`;
        valueSub = `Lv.${item.level || 1}`;
        statsText = `${item.totalGames || 0} 场 | 胜率 ${item.winRate || 0}%`;
      } else {
        valueMain = `🏆 ${item.winRate}%`;
        valueSub = `${item.wins}/${item.totalGames} 胜`;
        statsText = `筹码 ${item.chips?.toLocaleString() || 0}`;
      }
      
      return `
        <div class="leaderboard-item ${topClass}">
          <div class="leaderboard-rank">${rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank}</div>
          <div class="leaderboard-avatar">${avatarHtml}</div>
          <div class="leaderboard-info">
            <div class="leaderboard-name">${escapeHtml(item.username)}</div>
            <div class="leaderboard-stats">${statsText}</div>
          </div>
          <div class="leaderboard-value">
            <div class="leaderboard-value-main">${valueMain}</div>
            <div class="leaderboard-value-sub">${valueSub}</div>
          </div>
        </div>
      `;
    }).join('');
    
  } catch (err) {
    listEl.innerHTML = `<div class="leaderboard-empty">加载失败: ${err.message}</div>`;
  }
}

// ── Events ────────────────────────────────────────────────────
function setupEventListeners() {
  // Login tabs
  document.querySelectorAll('.login-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.login-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const tabId = tab.dataset.tab;
      document.getElementById(`tab-${tabId}`).classList.add('active');
    });
  });
  
  // Guest login
  const btnGuestLogin = document.getElementById('btn-guest-login');
  const guestName = document.getElementById('guest-name');
  if (btnGuestLogin) {
    btnGuestLogin.addEventListener('click', handleGuestLogin);
    if (guestName) {
      guestName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleGuestLogin();
      });
    }
  }
  
  // Login form
  const btnLogin = document.getElementById('btn-login');
  const loginUsername = document.getElementById('login-username');
  const loginPassword = document.getElementById('login-password');
  if (btnLogin) {
    btnLogin.addEventListener('click', handleLogin);
    if (loginPassword) {
      loginPassword.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleLogin();
      });
    }
  }
  
  // Register form
  const btnRegister = document.getElementById('btn-register');
  const registerPassword = document.getElementById('register-password');
  if (btnRegister) {
    btnRegister.addEventListener('click', handleRegister);
    if (registerPassword) {
      registerPassword.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleRegister();
      });
    }
  }
  
  els.btnLogout.addEventListener('click', logout);

  // Stake level selection
  document.querySelectorAll('.stake-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.stake-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedStakeLevel = btn.dataset.level;
    });
  });

  els.btnFindMatch.addEventListener('click', () => {
    if (socket) socket.emit('lobby:join', { stakeLevel: selectedStakeLevel });
  });

  els.btnCancelMatch.addEventListener('click', () => {
    if (socket) socket.emit('lobby:leave');
  });

  els.historyToggle.addEventListener('click', () => {
    els.historyPanel.classList.remove('hidden');
    if (socket) socket.emit('game:history');
  });

  els.historyClose.addEventListener('click', () => {
    els.historyPanel.classList.add('hidden');
  });

  // Chat events
  els.chatToggle.addEventListener('click', () => {
    els.chatPanel.classList.toggle('hidden');
    if (!els.chatPanel.classList.contains('hidden')) {
      clearChatBadge();
    }
  });

  els.chatClose.addEventListener('click', () => {
    els.chatPanel.classList.add('hidden');
  });

  els.btnSendChat.addEventListener('click', sendChatMessage);

  els.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  els.raiseSlider.addEventListener('input', () => {
    els.raiseValue.textContent = els.raiseSlider.value;
  });

  els.btnConfirmRaise.addEventListener('click', () => {
    const amount = parseInt(els.raiseSlider.value);
    raiseMode = false;
    performAction('raise', amount);
  });

  // Wallet login
  const walletLoginBtn = document.getElementById('wallet-login-btn');
  if (walletLoginBtn) {
    walletLoginBtn.addEventListener('click', handleWalletLogin);
  }

  // Profile panel
  const btnProfile = document.getElementById('btn-profile');
  if (btnProfile) {
    btnProfile.addEventListener('click', showProfilePanel);
  }

  const userProfile = document.querySelector('.user-profile');
  if (userProfile) {
    userProfile.style.cursor = 'pointer';
    userProfile.addEventListener('click', showProfilePanel);
  }

  const profileClose = document.getElementById('profile-close');
  if (profileClose) {
    profileClose.addEventListener('click', hideProfilePanel);
  }

  const btnLogoutProfile = document.getElementById('btn-logout-profile');
  if (btnLogoutProfile) {
    btnLogoutProfile.addEventListener('click', logout);
  }

  // Recharge panel
  const btnRecharge = document.getElementById('btn-recharge');
  if (btnRecharge) {
    btnRecharge.addEventListener('click', showRechargePanel);
  }

  const rechargeClose = document.getElementById('recharge-close');
  if (rechargeClose) {
    rechargeClose.addEventListener('click', hideRechargePanel);
  }

  // Token selector
  document.querySelectorAll('.token-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.token-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateRechargePreview();
    });
  });

  // Amount input
  const rechargeAmount = document.getElementById('recharge-amount');
  if (rechargeAmount) {
    rechargeAmount.addEventListener('input', updateRechargePreview);
  }

  // Create order button
  const btnCreateOrder = document.getElementById('btn-create-order');
  if (btnCreateOrder) {
    btnCreateOrder.addEventListener('click', createRechargeOrder);
  }

  // Copy address button
  const btnCopyAddress = document.getElementById('btn-copy-address');
  if (btnCopyAddress) {
    btnCopyAddress.addEventListener('click', copyRechargeAddress);
  }

  // Order panel
  const orderClose = document.getElementById('order-close');
  if (orderClose) {
    orderClose.addEventListener('click', hideOrderPanel);
  }

  const btnSubmitTx = document.getElementById('btn-submit-tx');
  if (btnSubmitTx) {
    btnSubmitTx.addEventListener('click', submitTransactionHash);
  }

  const btnRefreshOrder = document.getElementById('btn-refresh-order');
  if (btnRefreshOrder) {
    btnRefreshOrder.addEventListener('click', refreshOrderStatus);
  }

  // Leaderboard
  const btnLeaderboard = document.getElementById('btn-leaderboard');
  if (btnLeaderboard) {
    btnLeaderboard.addEventListener('click', showLeaderboard);
  }

  const leaderboardClose = document.getElementById('leaderboard-close');
  if (leaderboardClose) {
    leaderboardClose.addEventListener('click', hideLeaderboard);
  }

  document.querySelectorAll('.leaderboard-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.leaderboard-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadLeaderboard(tab.dataset.type);
    });
  });
}

// Global exposure for inline HTML handlers
window._action = (action) => performAction(action);
window._nextHand = () => nextHand();
window._backToLobby = () => backToLobby();
window._toggleRaise = () => {
  raiseMode = !raiseMode;
  renderActions();
};

// Start
init();
