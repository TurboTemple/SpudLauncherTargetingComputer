/** Target game: players take turns at the target; rings score points; a leaderboard ranks them. */

import { useState } from 'preact/hooks';
import { leaderboard } from '../core/game';
import { endGame, startGame, updateGame } from '../state/actions';
import { settings, shots, target } from '../state/store';
import { Card, NumberField } from './fields';
import { fmt } from './format';

export function GameCard() {
  const g = settings.value.game;
  const [names, setNames] = useState('');
  if (!g) {
    return (
      <Card title="Target game">
        <p class="small">Take turns at the target: 10 points inside 2 m, 5 inside 5 m, 2 inside 10 m. Closest to the pin wins ties.</p>
        <label class="field">
          <span class="field-label">Players (comma-separated)</span>
          <span class="field-input">
            <input type="text" value={names} placeholder="Sam, Alex" onInput={(e) => setNames((e.target as HTMLInputElement).value)} />
          </span>
        </label>
        <button class="btn btn-primary" onClick={() => startGame(names.split(','))}>
          Start game
        </button>
      </Card>
    );
  }
  const entries = shots.value
    .filter((s) => s.game?.id === g.id && s.game.points !== undefined && !s.excluded)
    .map((s) => ({ player: s.game!.player, distance: s.game!.distanceM!, points: s.game!.points! }));
  const table = leaderboard(entries);
  const last = shots.value.filter((s) => s.game?.id === g.id && s.game.points !== undefined).at(-1);
  return (
    <Card
      title="Target game"
      actions={
        <button class="btn btn-small btn-warn" onClick={endGame}>
          End game
        </button>
      }
    >
      {!target.value && <p class="banner banner-warn">Long-press the map to set the target.</p>}
      <div class="players" role="radiogroup" aria-label="Whose turn">
        {g.players.map((p) => (
          <button key={p} class={`btn btn-small ${p === g.player ? 'btn-primary' : ''}`} role="radio" aria-checked={p === g.player} onClick={() => updateGame({ player: p })}>
            {p}
          </button>
        ))}
      </div>
      <p class="small">
        <strong>{g.player}</strong> to shoot. Record the shot as usual (Shots); it scores when its landing is marked.
        {g.players.length > 1 && (
          <label class="toggle">
            <input type="checkbox" checked={g.rotate} onChange={(e) => updateGame({ rotate: (e.target as HTMLInputElement).checked })} />
            <span>Next player's turn after each saved shot</span>
          </label>
        )}
      </p>
      {last?.game && (
        <p class="game-last">
          Last: {last.game.player}, {fmt(last.game.distanceM)} m → <strong>{last.game.points} points</strong>
        </p>
      )}
      {table.length > 0 ? (
        <table class="table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Points</th>
              <th>Shots</th>
              <th>Closest m</th>
              <th>Average m</th>
            </tr>
          </thead>
          <tbody>
            {table.map((s, i) => (
              <tr key={s.player} class={i === 0 ? 'best' : ''}>
                <td>
                  {i === 0 ? '🏆 ' : ''}
                  {s.player}
                </td>
                <td>{s.total}</td>
                <td>{s.shots}</td>
                <td>{fmt(s.best)}</td>
                <td>{fmt(s.average)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="muted small">No scored shots yet.</p>
      )}
      <details>
        <summary class="small">Rings</summary>
        {g.rings.map((r, i) => (
          <div class="row" key={i}>
            <NumberField label={`Ring ${i + 1} radius`} unit="m" value={r.radius} min={0.5} max={100} onChange={(v) => updateGame({ rings: g.rings.map((x, k) => (k === i ? { ...x, radius: v } : x)) })} />
            <NumberField label="Points" unit="" digits={0} value={r.points} min={0} max={100} onChange={(v) => updateGame({ rings: g.rings.map((x, k) => (k === i ? { ...x, points: Math.round(v) } : x)) })} />
          </div>
        ))}
      </details>
    </Card>
  );
}
