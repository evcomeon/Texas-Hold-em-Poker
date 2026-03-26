/** @jest-environment jsdom */
import { renderTables } from '../../client/tableThumbnails.js';

describe('renderTables', () => {
  const tables = [
    {
      id: 'table-123456',
      stakeLevel: 'low',
      stakeName: 'Low Stakes',
      smallBlind: 10,
      bigBlind: 20,
      isFull: false,
      phase: 'WAITING',
      players: [],
      playerCount: 0,
      maxPlayers: 6,
    },
    {
      id: 'table-abcdef',
      stakeLevel: 'high',
      stakeName: 'High Stakes',
      smallBlind: 100,
      bigBlind: 200,
      isFull: true,
      phase: 'PLAYING',
      players: [],
      playerCount: 6,
      maxPlayers: 6,
    },
  ];

  beforeEach(() => {
    document.body.innerHTML = '<div id="tables-list"></div>';
    global.socket = { emit: jest.fn() };
  });

  test('creates a .table-card for each table and includes the table ID', () => {
    renderTables(tables);
    const cards = document.querySelectorAll('.table-card');
    expect(cards.length).toBe(tables.length);
    tables.forEach(t => {
      const card = document.querySelector(`.table-card[data-table-id="${t.id}"]`);
      expect(card).not.toBeNull();
    });
  });
});
