/** Target games: points by ring, and a leaderboard. */

export interface Ring {
  /** Radius around the target, m. */
  radius: number;
  points: number;
}

export const DEFAULT_RINGS: Ring[] = [
  { radius: 2, points: 10 },
  { radius: 5, points: 5 },
  { radius: 10, points: 2 },
];

/** Points for a landing `distance` metres from the target: the smallest ring it falls inside. */
export function scoreShot(distance: number, rings: readonly Ring[] = DEFAULT_RINGS): number {
  const sorted = [...rings].sort((a, b) => a.radius - b.radius);
  return sorted.find((r) => distance <= r.radius)?.points ?? 0;
}

export interface Standing {
  player: string;
  shots: number;
  total: number;
  /** Closest landing, m. */
  best: number;
  average: number;
}

/** Ranked by total points, then closest landing. */
export function leaderboard(entries: readonly { player: string; distance: number; points: number }[]): Standing[] {
  const by = new Map<string, Standing>();
  for (const e of entries) {
    const s = by.get(e.player) ?? { player: e.player, shots: 0, total: 0, best: Infinity, average: 0 };
    s.average = (s.average * s.shots + e.distance) / (s.shots + 1);
    s.shots += 1;
    s.total += e.points;
    s.best = Math.min(s.best, e.distance);
    by.set(e.player, s);
  }
  return [...by.values()].sort((a, b) => b.total - a.total || a.best - b.best);
}
