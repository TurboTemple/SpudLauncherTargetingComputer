import { describe, expect, it } from 'vitest';
import { leaderboard, scoreShot } from '../src/core/game';

describe('target game', () => {
  it('scores by the smallest ring containing the landing', () => {
    expect(scoreShot(0.5)).toBe(10);
    expect(scoreShot(2)).toBe(10);
    expect(scoreShot(3)).toBe(5);
    expect(scoreShot(9.9)).toBe(2);
    expect(scoreShot(12)).toBe(0);
    expect(scoreShot(4, [{ radius: 10, points: 1 }, { radius: 3, points: 3 }])).toBe(1);
  });

  it('ranks by total, then closest landing', () => {
    const t = leaderboard([
      { player: 'Sam', distance: 4, points: 5 },
      { player: 'Ali', distance: 1, points: 10 },
      { player: 'Sam', distance: 1.5, points: 10 },
      { player: 'Kim', distance: 3, points: 5 },
      { player: 'Kim', distance: 1.8, points: 10 },
    ]);
    // Sam and Kim tie on 15 points; Sam's closest landing (1.5 m) beats Kim's (1.8 m).
    expect(t.map((s) => s.player)).toEqual(['Sam', 'Kim', 'Ali']);
    expect(t[0]).toMatchObject({ shots: 2, total: 15, best: 1.5, average: 2.75 });
  });
});
