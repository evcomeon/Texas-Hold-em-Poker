class TableInfo {
  constructor(roomId, stakeLevel, stakeConfig) {
    this.id = roomId;
    this.stakeLevel = stakeLevel;
    this.stakeName = stakeConfig?.name || stakeLevel;
    this.smallBlind = stakeConfig?.smallBlind || 10;
    this.bigBlind = stakeConfig?.bigBlind || 20;
    this.players = [];
    this.spectatorCount = 0;
    this.phase = 'WAITING';
    this.createdAt = Date.now();
  }

  addPlayer(player) {
    const existing = this.players.find(p => p.id === player.id);
    if (existing) return;
    
    this.players.push({
      id: player.id,
      username: player.name || player.username,
      avatar: player.picture,
      ready: player.readyForNext || false,
      connectionState: player.connectionState || 'online',
      chips: player.chips,
      folded: player.folded,
      isActive: player.isActive
    });
  }

  removePlayer(playerId) {
    this.players = this.players.filter(p => p.id !== playerId);
  }

  updatePlayer(playerId, updates) {
    const player = this.players.find(p => p.id === playerId);
    if (player) {
      Object.assign(player, updates);
    }
  }

  setSpectatorCount(count) {
    this.spectatorCount = count;
  }

  setPhase(phase) {
    this.phase = phase;
  }

  getPlayerCount() {
    return this.players.length;
  }

  isFull() {
    return this.players.length >= 8;
  }

  hasActivePlayers() {
    return this.players.some(p => p.connectionState === 'online' && p.isActive);
  }

  toJSON() {
    return {
      id: this.id,
      stakeLevel: this.stakeLevel,
      stakeName: this.stakeName,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      players: this.players,
      playerCount: this.players.length,
      maxPlayers: 8,
      spectatorCount: this.spectatorCount,
      phase: this.phase,
      isFull: this.isFull(),
      createdAt: this.createdAt
    };
  }
}

module.exports = { TableInfo };
