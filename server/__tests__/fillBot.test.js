const {
  createFillBotsProvider,
} = require('../bots/fillBot');

describe('fill bot provider', () => {
  test('single queued human only gets one bot by default', () => {
    const provider = createFillBotsProvider();
    const bots = provider(1, { smallBlind: 10, bigBlind: 20 });

    expect(bots).toHaveLength(1);
    expect(bots[0].name).toBe('陪玩小助1');
  });

  test('two queued humans do not get extra bots by default', () => {
    const provider = createFillBotsProvider();
    const bots = provider(2, { smallBlind: 10, bigBlind: 20 });

    expect(bots).toEqual([]);
  });
});
