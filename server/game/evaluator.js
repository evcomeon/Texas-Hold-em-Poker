// ============================================================
// Texas Hold'em Poker - Hand Evaluator
// ============================================================
// Evaluates the best 5-card hand from 7 cards (2 hole + 5 community)

const HAND_RANKS = {
  ROYAL_FLUSH:     9,
  STRAIGHT_FLUSH:  8,
  FOUR_OF_A_KIND:  7,
  FULL_HOUSE:      6,
  FLUSH:           5,
  STRAIGHT:        4,
  THREE_OF_A_KIND: 3,
  TWO_PAIR:        2,
  ONE_PAIR:        1,
  HIGH_CARD:       0
};

const HAND_NAMES = {
  9: '皇家同花顺',
  8: '同花顺',
  7: '四条',
  6: '葫芦',
  5: '同花',
  4: '顺子',
  3: '三条',
  2: '两对',
  1: '一对',
  0: '高牌'
};

/**
 * Generate all C(n, k) combinations
 */
function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

/**
 * Evaluate a 5-card hand, returns { rank, scores, name }
 * scores is an array used for tiebreaking (higher is better)
 */
function evaluate5(cards) {
  const sorted = [...cards].sort((a, b) => b.value - a.value);
  const values = sorted.map(c => c.value);
  const suits = sorted.map(c => c.suit);

  // Check flush
  const isFlush = suits.every(s => s === suits[0]);

  // Check straight
  let isStraight = false;
  let straightHigh = 0;

  // Normal straight
  if (values[0] - values[4] === 4 && new Set(values).size === 5) {
    isStraight = true;
    straightHigh = values[0];
  }
  // Ace-low straight (A-2-3-4-5 = wheel)
  if (values[0] === 14 && values[1] === 5 && values[2] === 4 && values[3] === 3 && values[4] === 2) {
    isStraight = true;
    straightHigh = 5; // 5-high straight
  }

  // Count ranks
  const counts = {};
  for (const v of values) {
    counts[v] = (counts[v] || 0) + 1;
  }
  const groups = Object.entries(counts)
    .map(([v, c]) => ({ value: parseInt(v), count: c }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  // Royal Flush
  if (isFlush && isStraight && straightHigh === 14) {
    return { rank: HAND_RANKS.ROYAL_FLUSH, scores: [14], name: HAND_NAMES[9] };
  }

  // Straight Flush
  if (isFlush && isStraight) {
    return { rank: HAND_RANKS.STRAIGHT_FLUSH, scores: [straightHigh], name: HAND_NAMES[8] };
  }

  // Four of a Kind
  if (groups[0].count === 4) {
    return {
      rank: HAND_RANKS.FOUR_OF_A_KIND,
      scores: [groups[0].value, groups[1].value],
      name: HAND_NAMES[7]
    };
  }

  // Full House
  if (groups[0].count === 3 && groups[1].count === 2) {
    return {
      rank: HAND_RANKS.FULL_HOUSE,
      scores: [groups[0].value, groups[1].value],
      name: HAND_NAMES[6]
    };
  }

  // Flush
  if (isFlush) {
    return { rank: HAND_RANKS.FLUSH, scores: values, name: HAND_NAMES[5] };
  }

  // Straight
  if (isStraight) {
    return { rank: HAND_RANKS.STRAIGHT, scores: [straightHigh], name: HAND_NAMES[4] };
  }

  // Three of a Kind
  if (groups[0].count === 3) {
    const kickers = groups.slice(1).map(g => g.value);
    return {
      rank: HAND_RANKS.THREE_OF_A_KIND,
      scores: [groups[0].value, ...kickers],
      name: HAND_NAMES[3]
    };
  }

  // Two Pair
  if (groups[0].count === 2 && groups[1].count === 2) {
    const pairs = [groups[0].value, groups[1].value].sort((a, b) => b - a);
    return {
      rank: HAND_RANKS.TWO_PAIR,
      scores: [...pairs, groups[2].value],
      name: HAND_NAMES[2]
    };
  }

  // One Pair
  if (groups[0].count === 2) {
    const kickers = groups.slice(1).map(g => g.value);
    return {
      rank: HAND_RANKS.ONE_PAIR,
      scores: [groups[0].value, ...kickers],
      name: HAND_NAMES[1]
    };
  }

  // High Card
  return { rank: HAND_RANKS.HIGH_CARD, scores: values, name: HAND_NAMES[0] };
}

/**
 * Find the best 5-card hand from 7 cards
 */
function evaluateBest(sevenCards) {
  const allFive = combinations(sevenCards, 5);
  let best = null;
  for (const five of allFive) {
    const result = evaluate5(five);
    if (!best || compareHands(result, best) > 0) {
      best = result;
      best.cards = five;
    }
  }
  return best;
}

/**
 * Compare two evaluated hands. Returns >0 if a wins, <0 if b wins, 0 if tie.
 */
function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.min(a.scores.length, b.scores.length); i++) {
    if (a.scores[i] !== b.scores[i]) return a.scores[i] - b.scores[i];
  }
  return 0;
}

/**
 * Quick hand strength score (0-1) for AI decision making
 * Uses hole cards + community cards available
 */
function handStrength(holeCards, communityCards) {
  if (communityCards.length === 0) {
    // Pre-flop: estimate from hole cards only
    const c1 = holeCards[0], c2 = holeCards[1];
    let score = 0;
    // Pair bonus
    if (c1.value === c2.value) score += 0.4 + (c1.value / 14) * 0.3;
    // High card bonus
    score += (c1.value + c2.value) / 28 * 0.3;
    // Suited bonus
    if (c1.suit === c2.suit) score += 0.05;
    // Connected bonus
    const gap = Math.abs(c1.value - c2.value);
    if (gap <= 2) score += 0.05;
    return Math.min(1, score);
  }

  // Post-flop: evaluate actual hand
  const all = [...holeCards, ...communityCards];
  if (all.length >= 5) {
    const best = evaluateBest(all);
    // Map hand rank to a 0-1 scale
    return (best.rank + 0.5) / 10;
  }
  return 0.3;
}

module.exports = {
  HAND_RANKS, HAND_NAMES,
  evaluate5, evaluateBest, compareHands, handStrength, combinations
};
