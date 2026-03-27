// Lobby table list rendering helper.

export function renderTables(tables, onJoinTable = null) {
  const tablesList = document.getElementById('tables-list');
  if (!tablesList) return;

  if (!tables || tables.length === 0) {
    tablesList.innerHTML = '<div class="tables-empty">暂无活跃牌桌</div>';
    return;
  }

  const currentStakeLevel = document.querySelector('.stake-option.active')?.dataset.level || 'medium';
  const visibleTables = [...tables].sort((left, right) => {
    const leftStakeScore = left.stakeLevel === currentStakeLevel ? 0 : 1;
    const rightStakeScore = right.stakeLevel === currentStakeLevel ? 0 : 1;
    if (leftStakeScore !== rightStakeScore) return leftStakeScore - rightStakeScore;

    const leftPhaseScore = left.phase !== 'WAITING' && left.phase !== 'FINISHED' ? 0 : 1;
    const rightPhaseScore = right.phase !== 'WAITING' && right.phase !== 'FINISHED' ? 0 : 1;
    if (leftPhaseScore !== rightPhaseScore) return leftPhaseScore - rightPhaseScore;

    return (left.createdAt || 0) - (right.createdAt || 0);
  });

  tablesList.innerHTML = visibleTables.map((table) => {
    const isPlaying = table.phase !== 'WAITING' && table.phase !== 'FINISHED';
    const phaseClass = isPlaying ? 'playing' : 'waiting';
    const phaseText = isPlaying ? '游戏中' : '等待中';
    const buttonLabel = isPlaying ? '观战' : (table.isFull ? '已满' : '加入');
    const buttonDisabled = !isPlaying && table.isFull;
    const stakeHint = table.stakeLevel === currentStakeLevel ? '' : ` <span class="table-stake-hint">其他级别</span>`;

    const playersHtml = (table.players || []).map((player) => {
      const statusClass = player.connectionState !== 'online'
        ? 'offline'
        : (player.ready ? 'ready' : 'online');
      const avatar = player.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${player.username}`;
      return `<img src="${avatar}" alt="${player.username}" class="table-player-avatar ${statusClass}" title="${player.username}">`;
    }).join('');

    return `
      <div class="table-card ${table.isFull && !isPlaying ? 'full' : ''}" data-table-id="${table.id}">
        <div class="table-card-header">
          <span class="table-id">${table.id.slice(-6)}</span>
          <span class="table-phase ${phaseClass}">${phaseText}</span>
        </div>
        <div class="table-name">${table.stakeName}${stakeHint}</div>
        <div class="table-blinds">盲注 ${table.smallBlind}/${table.bigBlind}</div>
        <div class="table-players">${playersHtml || '<span class="tables-empty-inline">空桌</span>'}</div>
        <div class="table-footer">
          <span class="table-player-count">${table.playerCount}/${table.maxPlayers} 人</span>
          <button class="btn-join-table" ${buttonDisabled ? 'disabled' : ''}>${buttonLabel}</button>
        </div>
      </div>
    `;
  }).join('');

  tablesList.querySelectorAll('.btn-join-table').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (typeof onJoinTable !== 'function') return;
      const tableId = btn.closest('.table-card')?.dataset.tableId;
      if (tableId) {
        onJoinTable(tableId);
      }
    });
  });
}
