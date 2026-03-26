// Table Thumbnails rendering module
// Exports a renderTables function used by main.js to display active tables.

/**
 * Render an array of table objects into the #tables-list container.
 * Each table card includes ID, stake name, blinds, player avatars, count, and a join button.
 * Clicking the join button emits 'lobby:join_specific' via the global socket.
 * @param {Array} tables - List of table objects from the server.
 */
function renderTables(tables) {
  const tablesList = document.getElementById('tables-list');
  if (!tablesList) return;

  // No tables case
  if (!tables || tables.length === 0) {
    tablesList.innerHTML = '<div class="tables-empty">暂无活跃牌桌</div>';
    return;
  }

  const currentStakeLevel = document.querySelector('.stake-option.active')?.dataset.level || 'medium';
  const filteredTables = tables.filter(t => t.stakeLevel === currentStakeLevel);

  if (filteredTables.length === 0) {
    tablesList.innerHTML = '<div class="tables-empty">当前级别暂无活跃牌桌</div>';
    return;
  }

  tablesList.innerHTML = filteredTables.map(table => {
    const isFull = table.isFull;
    const phaseClass = table.phase === 'WAITING' ? '' : 'playing';
    const phaseText = table.phase === 'WAITING' ? '等待中' : '游戏中';
    const playersHtml = table.players.map(p => {
      const statusClass = p.connectionState !== 'online' ? 'offline' : (p.ready ? 'ready' : 'not-ready');
      const avatar = p.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.username}`;
      return `<img src="${avatar}" alt="${p.username}" class="table-player-avatar ${statusClass}" title="${p.username}">`;
    }).join('');
    return `
      <div class="table-card ${isFull ? 'full' : ''}" data-table-id="${table.id}">
        <div class="table-card-header">
          <span class="table-id">${table.id.slice(-6)}</span>
          <span class="table-phase ${phaseClass}">${phaseText}</span>
        </div>
        <div class="table-name">${table.stakeName}</div>
        <div class="table-blinds">盲注: ${table.smallBlind}/${table.bigBlind}</div>
        <div class="table-players">${playersHtml}</div>
        <div class="table-footer">
          <span class="table-player-count">${table.playerCount}/${table.maxPlayers} 人</span>
          <button class="btn-join-table" ${isFull ? 'disabled' : ''}>${isFull ? '已满' : '加入'}</button>
        </div>
      </div>
    `;
  }).join('');

  // Attach click listeners for join buttons
  tablesList.querySelectorAll('.btn-join-table').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tableId = btn.closest('.table-card').dataset.tableId;
      // Emit via global socket defined in main.js
      if (window.socket) {
        window.socket.emit('lobby:join_specific', { tableId });
      }
    });
  });
}

export { renderTables };
